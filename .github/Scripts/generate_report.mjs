import { Octokit } from "@octokit/rest";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
} from "docx";
import fs from "fs";
import path from "path";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const version = process.env.VERSION.trim();

  if (!version) throw new Error("VERSION non définie dans les inputs du workflow");

  const octokit = new Octokit({ auth: token });

  console.log(`🔍 Recherche de toutes les issues pour la version ${version}...`);

  // Récupère TOUTES les issues (ouvertes + fermées)
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  // Filtre les issues qui concernent cette version (titre, body ou label)
  const relevantIssues = issues.filter((issue) => {
    const body = (issue.body || "").toLowerCase();
    const title = (issue.title || "").toLowerCase();
    const labels = issue.labels.map((l) => l.name.toLowerCase());

    const hasVersion = body.includes(version.toLowerCase()) || title.includes(version.toLowerCase());
    const isRelevantType = labels.some((l) =>
      ["backlog", "test", "utilisateur", "bug", "issue test"].includes(l)
    );

    return hasVersion || isRelevantType;
  });

  console.log(`✅ ${relevantIssues.length} issues trouvées pour ${version}`);

  // ====================== CRÉATION DU DOCUMENT ======================
  const children = [];

  // === EN-TÊTE ===
  children.push(
    new Paragraph({
      text: `Halyzia® release : ${version} livré le ${new Date().toLocaleDateString("fr-FR")}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: `Tests démarrés automatiquement via GitHub Actions`,
      spacing: { after: 300 },
    })
  );

  // === LÉGENDE (identique à ton PDF) ===
  children.push(new Paragraph({ text: "Surlignage pour équipe dev :", bold: true }));
  const legendDev = [
    { color: "FF00FF", text: "issue indique que l’issue a été fixée par dev" },
    { color: "FFFF00", text: "issue indique que l’issue doit être fixée par dev" },
    { color: "00FFFF", text: "issue indique que l’issue sera corrigée dans une version ultérieure" },
    { color: "808080", text: "issue indique que l’issue est non reproductible" },
    { color: "FF0000", text: "issue indique que l’issue mérite une clarification ou est en cours d’analyse" },
    { color: "0000FF", text: "issue indique que l’issue a été testée qu’elle n’en est pas une (comportement normal, décision technique)" },
  ];
  legendDev.forEach((item) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "issue ", color: item.color, bold: true }), new TextRun(item.text)],
      })
    );
  });

  children.push(new Paragraph({ text: "Surlignage équipe test :", bold: true, spacing: { before: 300 } }));
  children.push(
    new Paragraph({ children: [new TextRun({ text: "issue ", color: "00FF00", bold: true }), new TextRun("indique que l’issue a été testée et validée")] }),
    new Paragraph({ children: [new TextRun({ text: "issue ", color: "FF00FF", bold: true }), new TextRun("indique que l’issue a été testée mais non validée")] })
  );

  // ====================== EXTRACTION INTELLIGENTE ======================
  const extractField = (body, possibleIds) => {
    for (const id of possibleIds) {
      const regex = new RegExp(`### ${id}\\s*([\\s\\S]*?)(?=\\n###|$|$)`, "i");
      const match = body.match(regex);
      if (match && match[1].trim()) return match[1].trim();
    }
    return "";
  };

  // ====================== AFFICHAGE DES ISSUES ======================
  relevantIssues.forEach((issue) => {
    const body = issue.body || "";
    const labels = issue.labels.map((l) => l.name);

    // Détection du type d'issue
    const isBacklog = labels.some((l) => l.toLowerCase().includes("backlog"));
    const isUserIssue = labels.some((l) => l.toLowerCase().includes("utilisateur"));

    children.push(
      new Paragraph({
        text: `Issue n°${issue.number}: ${issue.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    // Tableau résumé (Nom / Date / Statut / Gravité)
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.SINGLE }, bottom: { style: BorderStyle.SINGLE } },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph("Nom")] }),
            new TableCell({ children: [new Paragraph("Date")] }),
            new TableCell({ children: [new Paragraph("Statut")] }),
            new TableCell({ children: [new Paragraph("Remarque")] }),
            new TableCell({ children: [new Paragraph("Gravité")] }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(issue.user.login)] }),
            new TableCell({ children: [new Paragraph(new Date(issue.created_at).toLocaleDateString("fr-FR"))] }),
            new TableCell({ children: [new Paragraph(issue.state === "closed" ? "Fix / Closed" : "Open")] }),
            new TableCell({ children: [new Paragraph("")] }),
            new TableCell({ children: [new Paragraph(extractField(body, ["severite", "Severite"]) || "Mineur")] }),
          ],
        }),
      ],
    });
    children.push(table);

    // === CHAMPS DÉTAILLÉS SELON LE TYPE ===
    const fields = [];

    if (isBacklog) {
      fields.push({ label: "Utilisateur", value: extractField(body, ["Utilisateur"]) });
      fields.push({ label: "Demande", value: extractField(body, ["Demande"]) });
      fields.push({ label: "Description", value: extractField(body, ["Description"]) });
      fields.push({ label: "Décision prise", value: extractField(body, ["Decision"]) });
      fields.push({ label: "Milestone", value: extractField(body, ["Milestone"]) });
      fields.push({ label: "Commentaire", value: extractField(body, ["Commentaire"]) });
    } else {
      // Issue Test ou Issue Utilisateur
      fields.push({ label: "Version concernée", value: extractField(body, ["version"]) });
      fields.push({ label: "Workflow", value: extractField(body, ["workflow"]) });
      fields.push({ label: "Format du fichier", value: extractField(body, ["format"]) });
      fields.push({ label: isUserIssue ? "Fichier testé" : "Lien vers dossier/fichier", value: extractField(body, ["fichier", "test_data"]) });
      fields.push({ label: "PC utilisé", value: extractField(body, ["pc"]) });
      fields.push({ label: "Testeur", value: extractField(body, ["testeur"]) });
      fields.push({ label: "Système d’exploitation", value: extractField(body, ["os"]) });
      fields.push({ label: "Description", value: extractField(body, ["description", "Description du bug"]) });
      fields.push({ label: "Étapes pour reproduire", value: extractField(body, ["steps", "Etapes pour reproduire"]) });
      fields.push({ label: "Résultat attendu", value: extractField(body, ["expected"]) });
      fields.push({ label: "Résultat obtenu", value: extractField(body, ["actual"]) });
      fields.push({ label: "Logs / Erreurs", value: extractField(body, ["logs", "Lignes d'erreur"]) });
    }

    // Affichage des champs remplis
    fields.forEach((field) => {
      if (field.value) {
        children.push(
          new Paragraph({
            text: `${field.label} :`,
            bold: true,
            spacing: { before: 200 },
          }),
          new Paragraph({ text: field.value })
        );
      }
    });

    children.push(new Paragraph({ text: "", spacing: { after: 300 } }));
  });

  const doc = new Document({ sections: [{ properties: {}, children }] });

  const buffer = await Packer.toBuffer(doc);

  const filename = `reports/Bug_Report_Halyzia_V${version}.docx`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);

  console.log(`🎉 Rapport DOCX généré avec succès → ${filename} (${relevantIssues.length} issues)`);
}

main().catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
