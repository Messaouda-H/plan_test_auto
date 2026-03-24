// interactive_add_workflow.js
// Usage : node interactive_add_workflow.js

import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

// -------------------- CONFIG --------------------
const mdFolder = ".github/workflow-definitions";
const bugReportTemplatePath = ".github/ISSUE_TEMPLATE/bug_report.yml";
const workflowTemplatePath = "workflow-template.md";

// Assurez-vous que le dossier existe
if (!fs.existsSync(mdFolder)) fs.mkdirSync(mdFolder, { recursive: true });

// -------------------- READLINE --------------------
const rl = readline.createInterface({ input, output });

async function ask(question) {
  const answer = await rl.question(question + "\n> ");
  return answer.trim();
}

// -------------------- SCRIPT --------------------
async function main() {
  console.log("=== Création interactive d'un nouveau workflow ===");

  const workflowName = await ask("Nom du workflow (ex: WF-15 — Nouveau Test) :");
  if (!workflowName) {
    console.log("Nom obligatoire. Fin du script.");
    process.exit(1);
  }

  const objective = await ask("Objectif du workflow :");
  const requiredFile = await ask("Fichier requis / Format :");
  const montage = await ask("Montage (ex: macros + micros) :");

  console.log("\nMaintenant, entre les étapes de la checklist. Tape 'FIN' quand terminé.");

  const checklist = [];
  while (true) {
    const step = await ask(`- Étape ${checklist.length + 1} :`);
    if (step.toUpperCase() === "FIN") break;
    if (step) checklist.push(`- [ ] ${step}`);
  }

  // Lecture template markdown
  if (!fs.existsSync(workflowTemplatePath)) {
    console.error(`❌ Fichier template introuvable : ${workflowTemplatePath}`);
    process.exit(1);
  }
  const workflowTemplate = fs.readFileSync(workflowTemplatePath, "utf-8");

  const workflowContent = workflowTemplate
    .replace(/{{workflow_name}}/g, workflowName)
    .replace(/{{objective}}/g, objective)
    .replace(/{{required_file}}/g, requiredFile)
    .replace(/{{montage}}/g, montage)
    .replace(/{{checklist}}/g, checklist.join("\n"));

  const mdFilename = path.join(
    mdFolder,
    workflowName.replace(/[^a-z0-9_-]/gi, "_") + ".md"
  );
  fs.writeFileSync(mdFilename, workflowContent);
  console.log(`✅ Workflow généré : ${mdFilename}`);

  // -------------------- Mise à jour bug_report.yml --------------------
  if (!fs.existsSync(bugReportTemplatePath)) {
    console.error(`❌ bug_report.yml introuvable dans ${bugReportTemplatePath}`);
    process.exit(1);
  }

  let bugReportYml = fs.readFileSync(bugReportTemplatePath, "utf-8");

  // Récupérer tous les fichiers .md actuels
  const mdFiles = fs.readdirSync(mdFolder).filter(f => f.endsWith(".md"));
  const workflowOptions = mdFiles
    .map(f => {
      const name = f.replace(/_/g, " ").replace(".md", "");
      return `        - "${name}"`;
    })
    .join("\n");

  // Remplacer la section options entre les marqueurs
  bugReportYml = bugReportYml.replace(
    /# START WORKFLOW OPTIONS[\s\S]*# END WORKFLOW OPTIONS/,
    `# START WORKFLOW OPTIONS\n${workflowOptions}\n# END WORKFLOW OPTIONS`
  );

  fs.writeFileSync(bugReportTemplatePath, bugReportYml);
  console.log(`✅ bug_report.yml mis à jour avec le nouveau workflow`);

  rl.close();
  console.log("\n🎉 Workflow interactif terminé !");
}

main();