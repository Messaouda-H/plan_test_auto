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
  ImageRun,
} from "docx";
import fs from "fs";
import path from "path";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const version = process.env.VERSION?.trim();

  if (!version) throw new Error("VERSION non définie dans le workflow");

  const octokit = new Octokit({ auth: token });

  console.log(`🔍 Recherche des issues pour la version ${version}...`);

  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  const relevantIssues = issues.filter((issue) => {
    const body = (issue.body || "").toLowerCase();
    const title = (issue.title || "").toLowerCase();
    const labels = issue.labels.map((l) => l.name.toLowerCase());
    const hasVersion = body.includes(version.toLowerCase()) || title.includes(version.toLowerCase());
    const isRelevant = labels.some((l) => ["backlog", "test", "utilisateur", "bug", "issue test"].includes(l));
    return hasVersion || isRelevant;
  });

  console.log(`✅ ${relevantIssues.length} issues trouvées pour ${version}`);

  const children = [];

  // En-tête
  children.push(
    new Paragraph({
      text: `Halyzia® release : ${version} généré le ${new Date().toLocaleDateString("fr-FR")}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "Tests démarrés automatiquement via GitHub Actions", spacing: { after: 300 } })
  );

  // Légende
  children.push(new Paragraph({ text: "Surlignage pour équipe dev :", bold: true }));
  const legendDev = [
    { color: "FF00FF", text: "issue indique que l’issue a été fixée par dev" },
    { color: "FFFF00", text: "issue indique que l’issue doit être fixée par dev" },
    { color: "00FFFF", text: "issue indique que l’issue sera corrigée dans une version ultérieure" },
    { color: "808080", text: "issue indique que l’issue est non reproductible" },
    { color: "FF0000", text: "issue indique que l’issue mérite une clarification ou est en cours d’analyse" },
    { color: "0000FF", text: "issue indique que l’issue a été testée qu’elle n’en est pas une" },
  ];
  legendDev.forEach((item) => {
    children.push(new Paragraph({ children: [new TextRun({ text: "issue ", color: item.color, bold: true }), new TextRun(item.text)] }));
  });

  children.push(new Paragraph({ text: "Surlignage équipe test :", bold: true, spacing: { before: 300 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: "issue ", color: "00FF00", bold: true }), new TextRun("indique que l’issue a été testée et validée")] }));
  children.push(new Paragraph({ children: [new TextRun({ text: "issue ", color: "FF00FF", bold: true }), new TextRun("indique que l’issue a été testée mais non validée")] }));

  const extractField = (body, ids) => {
    for (const id of ids) {
      const regex = new RegExp(`### ${id}\\s*([\\s\\S]*?)(?=\\n###|$|$)`, "i");
      const match = body.match(regex);
      if (match && match[1].trim()) return match[1].trim();
    }
    return "";
  };

  const extractImages = (body) => {
    const urls = [];
    const regex = /!\[.*?\]\((https:\/\/user-images\.githubusercontent\.com\/[^)]+)\)/g;
    let match;
    while ((match = regex.exec(body)) !== null) urls.push(match[1]);
    return urls;
  };

  for (const issue of relevantIssues) {
    const body = issue.body || "";
    const isBacklog = issue.labels.some((l) => l.name.toLowerCase().includes("backlog"));
    const isUserIssue = issue.labels.some((l) => l.name.toLowerCase().includes("utilisateur"));

    children.push(new Paragraph({ text: `Issue n°${issue.number}: ${issue.title}`, heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));

    // Tableau résumé
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.SINGLE }, bottom: { style: BorderStyle.SINGLE } },
      rows: [
        new TableRow({ children: ["Nom", "Date", "Statut", "Remarque", "Gravité"].map(h => new TableCell({ children: [new Paragraph(h)] })) }),
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

    // Champs détaillés
    const fields = isBacklog ? [
      { label: "Utilisateur", value: extractField(body, ["Utilisateur"]) },
      { label: "Demande", value: extractField(body, ["Demande"]) },
      { label: "Description", value: extractField(body, ["Description"]) },
      { label: "Décision prise", value: extractField(body, ["Decision"]) },
      { label: "Milestone", value: extractField(body, ["Milestone"]) },
      { label: "Commentaire", value: extractField(body, ["Commentaire"]) },
    ] : [
      { label: "Version concernée", value: extractField(body, ["version"]) },
      { label: "Workflow", value: extractField(body, ["workflow"]) },
      { label: "Format du fichier", value: extractField(body, ["format"]) },
      { label: isUserIssue ? "Fichier testé" : "Lien test", value: extractField(body, ["fichier", "test_data"]) },
      { label: "PC utilisé", value: extractField(body, ["pc"]) },
      { label: "Testeur", value: extractField(body, ["testeur"]) },
      { label: "Système d’exploitation", value: extractField(body, ["os"]) },
      { label: "Description", value: extractField(body, ["description", "Description du bug"]) },
      { label: "Étapes pour reproduire", value: extractField(body, ["steps", "Etapes pour reproduire"]) },
      { label: "Résultat attendu", value: extractField(body, ["expected"]) },
      { label: "Résultat obtenu", value: extractField(body, ["actual"]) },
      { label: "Logs / Erreurs", value: extractField(body, ["logs", "Lignes d'erreur"]) },
    ];

    fields.forEach((f) => {
      if (f.value) {
        children.push(new Paragraph({ text: `${f.label} :`, bold: true, spacing: { before: 200 } }));
        children.push(new Paragraph(f.value));
      }
    });

    // === CAPTURES D'ÉCRAN ===
    const imageUrls = extractImages(body);
    if (imageUrls.length > 0) {
      children.push(new Paragraph({ text: "Captures d'écran :", bold: true, spacing: { before: 300 } }));

      for (const url of imageUrls) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error();
          const buffer = Buffer.from(await res.arrayBuffer());

          children.push(new Paragraph({
            children: [new ImageRun({ data: buffer, transformation: { width: 520, height: 0 } })],
            spacing: { before: 100, after: 100 }
          }));
        } catch (e) {
          console.warn(`⚠️ Impossible de télécharger l'image : ${url}`);
        }
      }
    }

    children.push(new Paragraph({ text: "", spacing: { after: 400 } }));
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);

  const filename = `reports/Bug_Report_Halyzia_V${version}.docx`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);

  console.log(`🎉 Rapport généré avec succès → ${filename} (${relevantIssues.length} issues)`);
}

main().catch((err) => {
  console.error("❌ Erreur critique :", err.message);
  console.error(err);
  process.exit(1);
});