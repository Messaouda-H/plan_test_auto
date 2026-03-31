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

const TARGET_VERSION = (process.env.VERSION || "V1.7.1").trim().toLowerCase();

// ✅ Parser robuste (ne casse plus avec GitHub forms)
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

// 🎯 Statut lisible
function formatStatus(labels) {
  const names = labels.map(l => l.name);

  if (names.includes("status: fixed")) return "🟩 Corrigé";
  if (names.includes("status: to test")) return "🟦 À tester";
  if (names.includes("status: in progress")) return "🟨 En cours";
  if (names.includes("status: blocked")) return "🟥 Bloqué";

  return "🟪 Inconnu";
}

async function generateReport() {
  console.log("📥 Fetching issues...");

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  const bugIssues = issues.filter(issue =>
    issue.labels.some(l => l.name === "bug")
  );

  console.log(`🐞 Total bugs: ${bugIssues.length}`);

  // 🔥 FILTRE CORRIGÉ + DEBUG
  const filtered = bugIssues.filter(issue => {
    const body = issue.body || "";

    extractField(body, "Version Halyzia concernee")
      .trim()
      .toLowerCase();

    console.log("------------");
    console.log("Issue:", issue.title);
    console.log("Version trouvée:", version);

    return version === TARGET_VERSION;
  });

  console.log(`✅ Issues retenues: ${filtered.length}`);

  // 🛑 sécurité → éviter rapport vide incompréhensible
  if (filtered.length === 0) {
    console.log("⚠️ Aucune issue trouvée → vérifie:");
    console.log("- Nom du champ: 'Version testée'");
    console.log("- Valeur exacte: ", TARGET_VERSION);
  }

  let md = `# 📊 Rapport QA — Version ${TARGET_VERSION}\n\n`;
  md += `Nombre d'issues : ${filtered.length}\n\n---\n\n`;

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

    // 📄 Markdown
    md += `## 🐞 Issue ${index + 1} — ${issue.title}\n\n`;
    md += `- Testeur : ${testeur}\n`;
    md += `- Statut : ${status}\n`;
    md += `- Gravité : ${gravite}\n`;
    md += `- Environnement : ${environnement}\n`;
    md += `- Fichier : ${fichier}\n`;
    md += `- Lien : ${issue.html_url}\n\n---\n\n`;

    // 📘 Word
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
      new Paragraph(`Lien : ${issue.html_url}`),
      new Paragraph("")
    );
  });

  // 📁 dossier reports
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

  console.log("🎉 Rapport généré !");
}

generateReport().catch(console.error);