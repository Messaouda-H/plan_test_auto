// generate_report.mjs
// Génère un rapport .docx par version Halyzia détectée depuis les labels GitHub

import { Octokit } from "@octokit/rest";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, Header, Footer, TabStopType, TabStopPosition
} from "docx";
import fs from "fs";
import path from "path";

// ─── Config ────────────────────────────────────────────────────────────────

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Détecte si un label ressemble à un numéro de version : 2.0.0.4, v2.0.0.4, version:2.0.0.4 */
function parseVersionLabel(labelName) {
  const cleaned = labelName.replace(/^version:/i, "").replace(/^v/i, "");
  if (/^\d+\.\d+(\.\d+)*$/.test(cleaned)) return cleaned;
  return null;
}

/** Extrait un champ depuis le body d'une issue GitHub */
function extractField(body, field) {
  if (!body) return "";
  const lines = body.split("\n").map(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(new RegExp(`^#{1,4}\\s*${field}`, "i"))) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && !lines[j].startsWith("#")) return lines[j];
      }
    }
    const inlineMatch = line.match(new RegExp(`\\*{1,2}${field}\\*{1,2}\\s*:?\\s*(.+)`, "i"));
    if (inlineMatch) return inlineMatch[1].trim();
  }
  return "";
}

/** Statut lisible depuis les labels */
function getStatus(labels) {
  const names = labels.map(l => l.name.toLowerCase());
  if (names.includes("status:done"))        return "Fix";
  if (names.includes("status:in progress")) return "Analyse en cours";
  if (names.includes("status:to test"))     return "À tester";
  if (names.includes("status:wont fix"))    return "Corrigée version ultérieure";
  if (names.includes("status:blocked"))     return "Bloqué";
  if (names.includes("status:not a bug"))   return "Pas un bug";
  if (names.includes("status:duplicate"))   return "Non reproductible";
  return "";
}

function getStatusColor(status) {
  switch (status) {
    case "Fix":                          return "90EE90";
    case "Analyse en cours":             return "FFFF99";
    case "À tester":                     return "D8BFD8";
    case "Corrigée version ultérieure":  return "ADD8E6";
    case "Bloqué":                       return "FFB6C1";
    case "Pas un bug":                   return "E0E0E0";
    default:                             return "FFFFFF";
  }
}

function getSeverityColor(gravity) {
  const g = (gravity || "").toLowerCase();
  if (g.includes("critique") || g.includes("critical")) return "FF6961";
  if (g.includes("majeur")   || g.includes("major"))    return "FFB6C1";
  if (g.includes("mineur")   || g.includes("minor"))    return "FFFF99";
  return "FFFFFF";
}

// ─── Composants DOCX ────────────────────────────────────────────────────────

const border = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };
const allBorders = { top: border, bottom: border, left: border, right: border };

function cell(text, opts = {}) {
  const { bold = false, fill = "FFFFFF", width = 1500, italic = false } = opts;
  return new TableCell({
    borders: allBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: String(text || ""), bold, italic, size: 18 })]
      })
    ]
  });
}

function buildIssueTable(issue) {
  const status   = getStatus(issue.labels);
  const gravity  = extractField(issue.body, "Gravité") || extractField(issue.body, "Severity") || "";
  const date     = issue.created_at ? issue.created_at.slice(0, 10) : "";
  const assignee = issue.assignees?.map(a => a.login).join(", ") || issue.user?.login || "";

  return new Table({
    width: { size: 8100, type: WidthType.DXA },
    columnWidths: [1600, 1000, 1800, 2500, 1200],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell("Nom",      { bold: true, fill: "D0E4F0", width: 1600 }),
          cell("Date",     { bold: true, fill: "D0E4F0", width: 1000 }),
          cell("Statut",   { bold: true, fill: "D0E4F0", width: 1800 }),
          cell("Remarque", { bold: true, fill: "D0E4F0", width: 2500 }),
          cell("Gravité",  { bold: true, fill: "D0E4F0", width: 1200 }),
        ]
      }),
      new TableRow({
        children: [
          cell(assignee, { width: 1600 }),
          cell(date,     { width: 1000 }),
          cell(status,   { width: 1800, fill: getStatusColor(status) }),
          cell("",       { width: 2500 }),
          cell(gravity,  { width: 1200, fill: getSeverityColor(gravity) }),
        ]
      })
    ]
  });
}

function buildDescription(body) {
  if (!body) return [];
  const paras = [];

  paras.push(
    new Paragraph({
      children: [new TextRun({ text: "Description détaillée :", bold: true, size: 20 })],
      spacing: { before: 200, after: 80 }
    })
  );

  let descText = body;
  const descMatch = body.match(/###\s*Description.*?\n([\s\S]*?)(?=\n###|$)/i);
  if (descMatch) descText = descMatch[1];

  for (const line of descText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    paras.push(
      new Paragraph({
        children: [new TextRun({ text: trimmed, size: 18 })],
        spacing: { after: 60 }
      })
    );
  }
  return paras;
}

// ─── Génération d'un .docx pour une version ──────────────────────────────────

async function generateDocxForVersion(version, issues) {
  const filtered = issues
    .filter(issue =>
      issue.labels.some(l => parseVersionLabel(l.name) === version)
    )
    .sort((a, b) => a.number - b.number);

  console.log(`  → v${version} : ${filtered.length} issue(s)`);

  const tocEntries = filtered.map((issue, i) =>
    new Paragraph({
      children: [new TextRun({ text: `Issue n°${i + 1} : ${issue.title}`, size: 18, color: "2E75B6" })],
      spacing: { after: 60 }
    })
  );

  const issueBlocks = [];
  filtered.forEach((issue, i) => {
    issueBlocks.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `Issue n°${i + 1} : ${issue.title}`, bold: true, size: 24, color: "2E75B6" })],
        spacing: { before: 400, after: 200 }
      })
    );
    issueBlocks.push(buildIssueTable(issue));
    issueBlocks.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    issueBlocks.push(...buildDescription(issue.body));
    issueBlocks.push(
      new Paragraph({
        children: [
          new TextRun({ text: "GitHub : ", size: 16, color: "888888" }),
          new TextRun({ text: issue.html_url, size: 16, color: "2E75B6" })
        ],
        spacing: { before: 100, after: 80 }
      })
    );
    issueBlocks.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
        children: [],
        spacing: { before: 200, after: 200 }
      })
    );
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal",
          run: { size: 32, bold: true, font: "Arial", color: "1F3864" },
          paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 }
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal",
          run: { size: 24, bold: true, font: "Arial", color: "2E75B6" },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 1 }
        },
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `Halyzia® Bug Report — Version ${version}`, bold: true, size: 18, color: "1F3864" }),
                new TextRun({ text: "\t\tCampagne test interne | PROC-TEST", size: 16, color: "888888" })
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6" } }
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "Page ", size: 16, color: "888888" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
                new TextRun({ text: " / ", size: 16, color: "888888" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "888888" })
              ],
              alignment: AlignmentType.RIGHT,
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } }
            })
          ]
        })
      },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: `Halyzia® release : ${version}`, bold: true, size: 36, color: "1F3864" })],
          spacing: { before: 0, after: 200 }
        }),
        new Paragraph({
          children: [new TextRun({ text: "Tests générés automatiquement via GitHub Actions", size: 18, italic: true, color: "555555" })],
          spacing: { after: 100 }
        }),
        new Paragraph({
          children: [new TextRun({ text: "Testeurs : Halissath / Filippo / Messaouda", size: 18 })],
          spacing: { after: 60 }
        }),
        new Paragraph({
          children: [new TextRun({ text: "Développeurs : Joël / Loïc / Adrien", size: 18 })],
          spacing: { after: 400 }
        }),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6" } },
          children: [],
          spacing: { before: 100, after: 300 }
        }),
        new Paragraph({
          children: [new TextRun({ text: "Table des matières", bold: true, size: 24, color: "1F3864" })],
          spacing: { before: 200, after: 160 }
        }),
        ...tocEntries,
        new Paragraph({ children: [new PageBreak()] }),
        ...issueBlocks,
      ]
    }]
  });

  return { buffer: await Packer.toBuffer(doc), count: filtered.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("🔍 Récupération de toutes les issues...");

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  console.log(`📋 ${issues.length} issues récupérées`);

  // Détecte toutes les versions uniques depuis les labels
  const versionsSet = new Set();
  for (const issue of issues) {
    for (const label of issue.labels) {
      const v = parseVersionLabel(label.name);
      if (v) versionsSet.add(v);
    }
  }

  const versions = [...versionsSet].sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  if (versions.length === 0) {
    console.warn("⚠️  Aucune version détectée dans les labels.");
    console.log("Labels trouvés :", [...new Set(issues.flatMap(i => i.labels.map(l => l.name)))].join(", "));
    process.exit(0);
  }

  console.log(`\n🏷️  Versions détectées : ${versions.join(", ")}`);

  // Création du dossier reports/
  const outDir = "reports";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Génération d'un .docx par version
  console.log("\n📝 Génération des rapports...");
  for (const version of versions) {
    const { buffer, count } = await generateDocxForVersion(version, issues);
    const filename = path.join(outDir, `Bug_Report_Halyzia_V${version}.docx`);
    fs.writeFileSync(filename, buffer);
    console.log(`  ✅ ${filename} (${count} issue(s))`);
  }

  console.log(`\n🎉 ${versions.length} rapport(s) générés dans /${outDir}/`);
}

run().catch(err => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
