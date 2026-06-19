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
  ExternalHyperlink,
} from "docx";
import fs from "fs";
import path from "path";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const version = process.env.VERSION?.trim();

  if (!version) throw new Error("VERSION non définie");

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

  console.log(`✅ ${relevantIssues.length} issues trouvées`);

  const extractField = (body, ids) => {
    for (const id of ids) {
      const regex = new RegExp(`### ${id}\\s*([\\s\\S]*?)(?=\\n###|$|$)`, "i");
      const match = body.match(regex);
      if (match && match[1].trim()) return match[1].trim();
    }
    return "";
  };

  const extractImages = (body) => {
    const urls = new Set();
    const markdownRegex = /!\[.*?\]\((https:\/\/[^)]+)\)/g;
    let match;
    while ((match = markdownRegex.exec(body)) !== null) {
      urls.add(match[1]);
    }
    const attachmentRegex = /https:\/\/github\.com\/user-attachments\/assets\/[^)\s>"]+/g;
    while ((match = attachmentRegex.exec(body)) !== null) {
      urls.add(match[0]);
    }
    const oldRegex = /https:\/\/user-images\.githubusercontent\.com\/[^)\s>"]+/g;
    while ((match = oldRegex.exec(body)) !== null) {
      urls.add(match[0]);
    }
    return Array.from(urls);
  };

  // ==================== REGROUPEMENT DES ISSUES PAR SESSION ====================
  const groupedIssues = {};
  const standaloneIssues = [];

  relevantIssues.forEach((issue) => {
    const body = issue.body || "";
    // On extrait la valeur de la session liée (par exemple : "test_messaouda_2026-05-04_v6.md")
    let sessionLinked = extractField(body, ["sessiontest", "La session test en cours quand l'annomalie est apparue"]);
    
    // Nettoyage des guillemets éventuels autour du nom de fichier
    if (sessionLinked) {
      sessionLinked = sessionLinked.replace(/^"|"$/g, '').trim();
    }

    if (sessionLinked && sessionLinked !== '""' && sessionLinked.toLowerCase() !== "aucun") {
      if (!groupedIssues[sessionLinked]) {
        groupedIssues[sessionLinked] = [];
      }
      groupedIssues[sessionLinked].push(issue);
    } else {
      standaloneIssues.push(issue);
    }
  });

  const children = [];

  // En-tête + légende
  children.push(
    new Paragraph({
      text: `Halyzia® release : ${version} généré le ${new Date().toLocaleDateString("fr-FR")}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "Tests démarrés automatiquement via GitHub Actions", spacing: { after: 300 } })
  );

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

  // Fonction interne pour générer le bloc d'une issue individuelle
  const appendIssueBlock = (issue) => {
    const body = issue.body || "";
    const isBacklog = issue.labels.some((l) => l.name.toLowerCase().includes("backlog"));
    const isUserIssue = issue.labels.some((l) => l.name.toLowerCase().includes("utilisateur"));

    children.push(new Paragraph({ text: `Issue n°${issue.number}: ${issue.title}`, heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 150 } }));

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

    const imageUrls = extractImages(body);
    if (imageUrls.length > 0) {
      children.push(new Paragraph({ text: "Captures d'écran :", bold: true, spacing: { before: 300 } }));
      imageUrls.forEach((url, i) => {
        children.push(
          new Paragraph({
            children: [
              new ExternalHyperlink({
                children: [new TextRun({ text: ` Capture ${i + 1} - Ctrl + clic pour suivre le lien `, style: { color: "0000FF", underline: true } })],
                link: url
              })
            ],
            spacing: { before: 80, after: 80 }
          })
        );
      });
    } else {
      children.push(new Paragraph({ text: "(Aucune capture d'écran détectée dans cette issue)", italic: true }));
    }

    children.push(new Paragraph({ text: "", spacing: { after: 300 } }));
  };

  // ==================== GENERATION SECTIONS : SESSIONS DE TESTS ====================
  for (const sessionName of Object.keys(groupedIssues)) {
    children.push(
      new Paragraph({
        text: `📍 Session de Test : ${sessionName}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 500, after: 200 },
      })
    );

    // Injection de toutes les issues liées à cette session spécifique
    groupedIssues[sessionName].forEach((issue) => {
      appendIssueBlock(issue);
    });
  }

  // ==================== GENERATION SECTIONS : ISSUES ORPHELINES / AUTRES ====================
  if (standaloneIssues.length > 0) {
    children.push(
      new Paragraph({
        text: `📍 Issues hors Session (Backlogs et Demandes Externes)`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 500, after: 200 },
      })
    );

    standaloneIssues.forEach((issue) => {
      appendIssueBlock(issue);
    });
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);

  const filename = `reports/Bug_Report_Halyzia_V${version}.docx`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);

  console.log(`🎉 Rapport généré → ${filename} (${relevantIssues.length} issues organisées par session)`);
}

main().catch((err) => {
  console.error("❌ Erreur :", err.message);
  process.exit(1);
});