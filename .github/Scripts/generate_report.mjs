import { Octokit } from "@octokit/rest";
import fs from "fs";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const TARGET_VERSION = process.env.VERSION;


// 🔍 extraction champs
function extractField(body, field) {
  if (!body) return "N/A";

  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(field.toLowerCase())) {
      return (lines[i + 1] || "").trim();
    }
  }
  return "N/A";
}


// 🎯 statut kanban
function getStatus(labels) {
  const names = labels.map(l => l.name.toLowerCase());

  if (names.includes("status:done")) return "🟩 Fix";
  if (names.includes("status:in progress")) return "🟨 Analyse en cours";
  if (names.includes("status:to test")) return "🟪 À tester";
  if (names.includes("status:blocked")) return "🟥 Bloqué";

  return "❓ Inconnu";
}


async function run() {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: "all",
  });

  // 🎯 filtre version
  const filtered = issues.filter(issue =>
    issue.labels.some(l => l.name === `version:${TARGET_VERSION}`)
  );

  let md = "";

  // 🧾 HEADER (comme ton PDF)
  md += `# Halyzia® release : ${TARGET_VERSION}\n`;
  md += `Tests démarrés automatiquement\n\n`;

  md += `---\n\n`;

  // 🐞 ISSUES
  filtered.forEach((issue, i) => {
    const body = issue.body || "";

    const testeur = extractField(body, "Testeur");
    const gravite = extractField(body, "Gravité");
    const description = extractField(body, "Description");

    const status = getStatus(issue.labels);

    md += `## Issue n°${i + 1} : ${issue.title}\n\n`;

    md += `### Description détaillée :\n`;
    md += `${body}\n\n`;

    // 🔥 tableau EXACT style PDF
    md += `| Nom | Date | Statut | Remarque | Gravité |\n`;
    md += `|-----|------|--------|----------|---------|\n`;
    md += `| ${testeur} | ${issue.created_at.slice(0,10)} | ${status} | - | ${gravite} |\n\n`;

    md += `Lien : ${issue.html_url}\n\n`;

    md += `---\n\n`;
  });

  fs.writeFileSync("reports/report.md", md);

  console.log("✅ Rapport fidèle au PDF généré !");
}

run();