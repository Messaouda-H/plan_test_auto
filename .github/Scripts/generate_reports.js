const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel
} = require("docx");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
const repo = process.env.GITHUB_REPOSITORY.split("/")[1];

// 👉 version cible (modifiable ou dynamique)
const TARGET_VERSION = process.env.VERSION || "2.0.0.4";

// 🔍 Extraire une valeur depuis le body GitHub
function extractField(body, fieldName) {
  const regex = new RegExp(`### ${fieldName}\\s*\\n(.+)`);
  const match = body.match(regex);
  return match ? match[1].trim() : "N/A";
}

// 🎯 Traduction statut avec emoji
function formatStatus(labels) {
  const names = labels.map(l => l.name);

  if (names.includes("status: fixed")) return "🟩 Corrigé";
  if (names.includes("status: to test")) return "🟦 À tester";
  if (names.includes("status: in progress")) return "🟨 En cours";
  if (names.includes("status: blocked")) return "🟥 Bloqué";

  return "🟪 Inconnu";
}

// 🔥 MAIN
async function generateReport() {
  console.log("Fetching issues...");

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  // 🎯 filtrer bugs uniquement
  const bugIssues = issues.filter(issue =>
    issue.labels.some(l => l.name === "bug")
  );

  // 🎯 filtrer par version
  const filtered = bugIssues.filter(issue => {
    const version = extractField(issue.body || "", "Version");
    return version === TARGET_VERSION;
  });

  console.log(`Found ${filtered.length} issues for version ${TARGET_VERSION}`);

  let md = `# 📊 Rapport QA — Version ${TARGET_VERSION}\n\n`;
  md += `Nombre total d'issues : **${filtered.length}**\n\n---\n\n`;

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
    md += `## 🐞 Issue #${index + 1} — ${issue.title}\n\n`;
    md += `- **Testeur :** ${testeur}\n`;
    md += `- **Statut :** ${status}\n`;
    md += `- **Gravité :** ${gravite}\n`;
    md += `- **Environnement :** ${environnement}\n`;
    md += `- **Fichier test :** ${fichier}\n`;
    md += `- **Lien :** ${issue.html_url}\n\n---\n\n`;

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
      new Paragraph(`Fichier test : ${fichier}`),
      new Paragraph(`Lien : ${issue.html_url}`),
      new Paragraph("\n")
    );
  });

  // 📁 créer dossier reports
  const reportDir = path.join(__dirname, "../../reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
  }

  // 💾 Markdown
  const mdPath = path.join(reportDir, `report_${TARGET_VERSION}.md`);
  fs.writeFileSync(mdPath, md);

  // 💾 Word
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const docxPath = path.join(reportDir, `report_${TARGET_VERSION}.docx`);
  fs.writeFileSync(docxPath, buffer);

  console.log("✅ Report generated !");
}

generateReport().catch(console.error);