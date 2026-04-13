const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Dossier des workflows
const workflowsDir = path.join(__dirname, "..", "workflow-definition");

// Fichier test_session YAML
const bugTemplatePath = path.join(__dirname, "..", "ISSUE_TEMPLATE", "test_session.yml");

// Lire tous les fichiers Markdown
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter(f => f.endsWith(".md"))
  .sort();

// Extraire le titre depuis la première ligne de chaque fichier Markdown
const workflowOptions = workflowFiles.map(f => {
  const content = fs.readFileSync(path.join(workflowsDir, f), "utf-8");
  const firstLine = content.split("\n").find(line => line.startsWith("#"));
  const title = firstLine ? firstLine.replace(/^#\s*/, "") : f.replace(".md", "");
  return `"${title}"`;
});

// Lire le YAML existant
const yamlContent = fs.readFileSync(bugTemplatePath, "utf-8");
const doc = yaml.load(yamlContent);

// Mettre à jour le dropdown "workflow"
doc.body.forEach(field => {
  if (field.id === "workflow") {
    field.attributes.options = workflowOptions;
  }
});

// Écrire le YAML mis à jour
fs.writeFileSync(bugTemplatePath, yaml.dump(doc), "utf-8");
console.log("test_session.yml mis à jour avec les sessions test existants !");