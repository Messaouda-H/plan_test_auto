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
  ShadingType,
  BorderStyle,
} from "docx";
import fs from "fs";
import path from "path";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const version = process.env.VERSION.trim();

  if (!version) throw new Error("VERSION non définie");

  const octokit = new Octokit({ auth: token });

  console.log(`🔍 Recherche des issues pour la version ${version}...`);

  // Récupère TOUTES les issues (ouvertes + fermées)
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  // Filtre les issues qui concernent cette version (dans le body ou le titre)
  const relevantIssues = issues.filter((issue) => {
    const body = issue.body || "";
    const title = issue.title || "";
    return (
      (body.includes(version) || title.includes(version)) &&
      (issue.labels.some((l) => ["bug", "Test", "Issue Test", "Utilisateur"].includes(l.name)) ||
        body.includes("Version Halyzia concernee"))
    );
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
      spacing: { after: 200 },
    })
  );

  // === LÉGENDE (exactement comme dans ton PDF) ===
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
        children: [
          new TextRun({ text: "issue ", color: item.color, bold: true }),
          new TextRun({ text: item.text }),
        ],
      })
    );
  });

  children.push(new Paragraph({ text: "Surlignage équipe test :", bold: true, spacing: { before: 200 } }));
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "issue ", color: "00FF00", bold: true }),
        new TextRun("indique que l’issue a été testée et validée"),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "issue ", color: "FF00FF", bold: true }),
        new TextRun("indique que l’issue a été testée mais non validée"),
      ],
    })
  );

  // === ISSUES ===
  relevantIssues.forEach((issue) => {
    // Extraction des champs du template GitHub
    const extract = (label) => {
      const regex = new RegExp(`### ${label}\\s*([\\s\\S]*?)(?=\\n###|$)`);
      const match = (issue.body || "").match(regex);
      return match ? match[1].trim() : "Non renseigné";
    };

    const description = extract("Description du bug") || extract("Description");
    const steps = extract("Etapes pour reproduire");
    const logs = extract("Lignes d'erreur");

    children.push(
      new Paragraph({
        text: `Issue n°${issue.number}: ${issue.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    // Tableau statut (simple mais lisible)
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
            new TableCell({ children: [new Paragraph(extract("Severite") || "Mineur")] }),
          ],
        }),
      ],
    });

    children.push(table);

    // Description détaillée
    children.push(
      new Paragraph({ text: "Description détaillée :", bold: true, spacing: { before: 200 } }),
      new Paragraph(description),
    );

    if (steps) {
      children.push(new Paragraph({ text: "Étapes pour reproduire :", bold: true, spacing: { before: 200 } }));
      children.push(new Paragraph(steps));
    }

    if (logs) {
      children.push(new Paragraph({ text: "Logs / Traceback :", bold: true, spacing: { before: 200 } }));
      children.push(new Paragraph({ text: logs, alignment: AlignmentType.LEFT }));
    }
  });

  const doc = new Document({ sections: [{ properties: {}, children }] });

  const buffer = await Packer.toBuffer(doc);

  const filename = `reports/Bug_Report_Halyzia_V${version}.docx`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);

  console.log(`🎉 Rapport généré avec succès → ${filename} (${relevantIssues.length} issues)`);
}

main().catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});