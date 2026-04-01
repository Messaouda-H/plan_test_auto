// generate_report.mjs
// Génère un rapport .docx fidèle au format PDF Halyzia
// à partir des issues GitHub filtrées par label de version

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
const TARGET_VERSION = process.env.VERSION; // ex: "2.0.0.4"

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extraire un champ depuis un body d'issue GitHub
 * Supporte deux formats :
 *   ### Gravité\nMajeur
 *   **Gravité:** Majeur
 */
function extractField(body, field) {
  if (!body) return "";
  const lines = body.split("\n").map(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Format markdown heading: ### Gravité
    if (line.match(new RegExp(`^#{1,4}\\s*${field}`, "i"))) {
      // cherche la prochaine ligne non vide
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] && !lines[j].startsWith("#")) return lines[j];
      }
    }

    // Format bold inline: **Gravité:** valeur  ou  **Gravité** : valeur
    const inlineMatch = line.match(
      new RegExp(`\\*{1,2}${field}\\*{1,2}\\s*:?\\s*(.+)`, "i")
    );
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

/** Couleur de fond selon statut */
function getStatusColor(status) {
  switch (status) {
    case "Fix":                         return "90EE90"; // vert
    case "Analyse en cours":            return "FFFF99"; // jaune
    case "À tester":                    return "D8BFD8"; // violet clair
    case "Corrigée version ultérieure": return "ADD8E6"; // bleu clair
    case "Bloqué":                      return "FFB6C1"; // rouge clair
    case "Pas un bug":                  return "E0E0E0"; // gris
    default:                            return "FFFFFF";
  }
}

/** Gravité → couleur */
function getSeverityColor(gravity) {
  const g = (gravity || "").toLowerCase();
  if (g.includes("majeur") || g.includes("major"))   return "FFB6C1";
  if (g.includes("mineur") || g.includes("minor"))   return "FFFF99";
  if (g.includes("critique") || g.includes("critical")) return "FF6961";
  return "FFFFFF";
}

// ─── Composants DOCX ────────────────────────────────────────────────────────

const border = { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" };
const allBorders = { top: border, bottom: border, left: border, right: border };

function cell(text, opts = {}) {
  const { bold = false, fill = "FFFFFF", width = 1500, italic = false, color = "000000" } = opts;
  return new TableCell({
    borders: allBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: String(text || ""), bold, italic, color, size: 18 })
        ]
      })
    ]
  });
}

function headerRow(cols) {
  return new TableRow({
    tableHeader: true,
    children: cols.map(([text, width]) =>
      cell(text, { bold: true, fill: "D0E4F0", width })
    )
  });
}

function issueRow(issue, status, gravity) {
  const date = issue.created_at ? issue.created_at.slice(0, 10) : "";
  const assignee = issue.assignees?.map(a => a.login).join(", ") || issue.user?.login || "";
  const statusFill = getStatusColor(status);
  const gravityFill = getSeverityColor(gravity);

  return new TableRow({
    children: [
      cell(assignee,             { width: 1600 }),
      cell(date,                 { width: 1000 }),
      cell(status,               { width: 1800, fill: statusFill }),
      cell("",                   { width: 2500 }), // Remarque (vide, à remplir à la réunion)
      cell(gravity,              { width: 1200, fill: gravityFill }),
    ]
  });
}

function buildIssueTable(issue) {
  const status = getStatus(issue.labels);
  const gravity = extractField(issue.body, "Gravité") ||
                  extractField(issue.body, "Severity") || "";

  return new Table({
    width: { size: 8100, type: WidthType.DXA },
    columnWidths: [1600, 1000, 1800, 2500, 1200],
    rows: [
      headerRow([["Nom", 1600], ["Date", 1000], ["Statut", 1800], ["Remarque", 2500], ["Gravité", 1200]]),
      issueRow(issue, status, gravity),
    ]
  });
}

/** Description issue : paragraphes depuis le body */
function buildDescription(body) {
  if (!body) return [];

  const paras = [];
  paras.push(
    new Paragraph({
      children: [new TextRun({ text: "Description détaillée :", bold: true, size: 20 })],
      spacing: { before: 200, after: 80 }
    })
  );

  // Extraire la section "Description" si présente, sinon prendre tout le body
  let descText = body;
  const descMatch = body.match(/###\s*Description.*?\n([\s\S]*?)(?=\n###|$)/i);
  if (descMatch) descText = descMatch[1];

  // Ajouter chaque ligne non-vide comme paragraph
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

// ─── Génération du document ──────────────────────────────────────────────────

async function run() {
  console.log(`🔍 Récupération des issues pour la version ${TARGET_VERSION}...`);

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  console.log(`📋 ${issues.length} issues récupérées au total`);

  // Filtre : label "version:X.X.X.X" OU "vX.X.X.X" OU le titre contient la version
  const filtered = issues.filter(issue => {
    const labelMatch = issue.labels.some(l =>
      l.name === TARGET_VERSION ||
      l.name === `version:${TARGET_VERSION}` ||
      l.name.toLowerCase() === `v${TARGET_VERSION}`.toLowerCase()
    );
    // Fallback : milestone
    const milestoneMatch = issue.milestone?.title === TARGET_VERSION ||
                           issue.milestone?.title === `v${TARGET_VERSION}`;
    return labelMatch || milestoneMatch;
  });

  console.log(`✅ ${filtered.length} issues filtrées pour v${TARGET_VERSION}`);

  if (filtered.length === 0) {
    console.warn("⚠️  Aucune issue trouvée. Vérifiez le nom du label (ex: '2.0.0.4' ou 'version:2.0.0.4')");
    console.log("Labels existants :", [...new Set(issues.flatMap(i => i.labels.map(l => l.name)))].join(", "));
  }

  // ── Tri par numéro d'issue
  filtered.sort((a, b) => a.number - b.number);

  // ── Table des matières (sommaire simple)
  const tocEntries = filtered.map((issue, i) =>
    new Paragraph({
      children: [
        new TextRun({ text: `Issue n°${i + 1} : ${issue.title}`, size: 18, color: "2E75B6" })
      ],
      spacing: { after: 60 }
    })
  );

  // ── Sections issues
  const issueBlocks = [];
  filtered.forEach((issue, i) => {
    issueBlocks.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: `Issue n°${i + 1} : ${issue.title}`, bold: true, size: 24, color: "2E75B6" })
        ],
        spacing: { before: 400, after: 200 }
      })
    );

    issueBlocks.push(buildIssueTable(issue));
    issueBlocks.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    issueBlocks.push(...buildDescription(issue.body));

    // Lien GitHub
    issueBlocks.push(
      new Paragraph({
        children: [
          new TextRun({ text: `GitHub : `, size: 16, color: "888888" }),
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

  // ── Construction du document complet
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 } }
      },
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
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } // ~2cm
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `Halyzia® Bug Report — Version ${TARGET_VERSION}`, bold: true, size: 18, color: "1F3864" }),
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
        // ── TITRE PRINCIPAL
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [
            new TextRun({ text: `Halyzia® release : ${TARGET_VERSION}`, bold: true, size: 36, color: "1F3864" })
          ],
          spacing: { before: 0, after: 200 }
        }),

        new Paragraph({
          children: [
            new TextRun({ text: `Tests démarrés automatiquement via GitHub Actions`, size: 18, italic: true, color: "555555" })
          ],
          spacing: { after: 100 }
        }),

        new Paragraph({
          children: [
            new TextRun({ text: `Testeurs : Halissath / Filippo / Messaouda`, size: 18 })
          ],
          spacing: { after: 60 }
        }),

        new Paragraph({
          children: [
            new TextRun({ text: `Développeurs : Joël / Loïc / Adrien`, size: 18 })
          ],
          spacing: { after: 400 }
        }),

        // ── LÉGENDE SURLIGNAGE
        new Paragraph({
          children: [new TextRun({ text: "Légende des statuts :", bold: true, size: 20 })],
          spacing: { before: 200, after: 100 }
        }),

        ...[
          ["Fix", "90EE90", "Issue fixée par dev"],
          ["À corriger", "FFB6C1", "Issue à fixer par dev"],
          ["Corrigée version ultérieure", "ADD8E6", "Sera corrigée plus tard"],
          ["Non reproductible", "E0E0E0", "Non reproductible"],
          ["Analyse en cours", "FFFF99", "En cours d'analyse"],
          ["Pas un bug", "FFFFFF", "Comportement normal / décision technique"],
        ].map(([label, fill, desc]) =>
          new Paragraph({
            children: [
              new TextRun({ text: `  ${label}  `, highlight: fill === "FFFFFF" ? undefined : undefined,
                            color: "000000", size: 18,
                            shading: { type: ShadingType.CLEAR, fill } }),
              new TextRun({ text: `  — ${desc}`, size: 18 })
            ],
            spacing: { after: 60 }
          })
        ),

        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6" } },
          children: [],
          spacing: { before: 300, after: 300 }
        }),

        // ── TABLE DES MATIÈRES
        new Paragraph({
          children: [new TextRun({ text: "Table des matières", bold: true, size: 24, color: "1F3864" })],
          spacing: { before: 200, after: 160 }
        }),
        ...tocEntries,

        new Paragraph({
          children: [new PageBreak()],
        }),

        // ── ISSUES
        ...issueBlocks,
      ]
    }]
  });

  // ── Export
  const outDir = "reports";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = path.join(outDir, `Bug_Report_Halyzia_V${TARGET_VERSION}.docx`);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filename, buffer);

  console.log(`\n✅ Rapport généré : ${filename}`);
  console.log(`   ${filtered.length} issue(s) incluses`);
}

run().catch(err => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
