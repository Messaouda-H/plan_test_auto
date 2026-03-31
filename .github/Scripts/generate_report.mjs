import { Octokit } from "@octokit/rest";
import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel
} from "docx";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const TARGET_VERSION = process.env.VERSION || "2.0.0.4";

function extractField(body, fieldName) {
  if (!body) return "N/A";

  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(fieldName.toLowerCase())) {
      return (lines[i + 1] || "").trim();
    }
  }

  return "N/A";
}

function formatStatus(labels) {
  const names = labels.map(l => l.name);

  if (names.includes("status: fixed")) return "🟩 Corrigé";
  if (names.includes("status: to test")) return "🟦 À tester";
  if (names.includes("status: in progress")) return "🟨 En cours";
  if (names.includes("status: blocked")) return "🟥 Bloqué";

  return "🟪 Inconnu";
}

async function generateReport() {
  console.log("Fetching issues...");

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  const bugIssues = issues.filter(issue =>
    issue.labels.some(l => l.name === "bug")
  );

  const filtered = bugIssues.filter(issue => {
    const version = extractField(issue.body || "", "Version");
    return version === TARGET_VERSION;
  });

  console.log(`Found ${filtered.length} issues`);

  let md = `# Rapport QA — Version ${TARGET_VERSION}\n\n`;

  const docChildren = [];

  docChildren.push(
    new Paragraph({
      text: `Rapport QA — Version ${TARGET_VERSION}`,
      heading: HeadingLevel.TITLE,
    })
  );

  filtered.forEach((issue, index) => {
    const body = issue.body || "";

    const testeur = extractField(body, "Testeur");
    const gravite = extractField(body, "Gravité");
    const environnement = extractField(body, "Environnement");
    const fichier = extractField(body, "Lien vers dossier de test");

    const status = formatStatus(issue.labels);

    md += `## Issue ${index + 1} — ${issue.title}\n\n`;
    md += `- Testeur : ${testeur}\n`;
    md += `- Statut : ${status}\n`;
    md += `- Gravité : ${gravite}\n`;
    md += `- Environnement : ${environnement}\n`;
    md += `- Fichier : ${fichier}\n\n`;

    docChildren.push(
      new Paragraph({
        text: `Issue ${index + 1} : ${issue.title}`,
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph(`Testeur : ${testeur}`),
      new Paragraph(`Statut : ${status}`),
      new Paragraph(`Gravité : ${gravite}`),
      new Paragraph(`Environnement : ${environnement}`),
      new Paragraph(`Fichier : ${fichier}`),
      new Paragraph("")
    );
  });

  const reportDir = new URL("../../reports", import.meta.url).pathname;

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  fs.writeFileSync(`${reportDir}/report_${TARGET_VERSION}.md`, md);

  const doc = new Document({
    sections: [{ children: docChildren }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(`${reportDir}/report_${TARGET_VERSION}.docx`, buffer);

  console.log("✅ Report generated");
}

generateReport().catch(console.error);