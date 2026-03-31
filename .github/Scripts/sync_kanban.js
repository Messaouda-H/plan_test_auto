import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

const TOKEN           = process.env.PAT_TOKEN;
const OWNER           = process.env.OWNER;
const REPO            = process.env.REPO;
const PROJECT_NUMBERS = process.env.PROJECT_NUMBERS.split(",").map(Number);

const octokit = new Octokit({ auth: TOKEN });
const gql     = graphql.defaults({
  headers: { authorization: `token ${TOKEN}` }
});

// Règles de transition par projet
// Adapte les numéros, statusTrigger, removeLabel, addLabel à ton setup
const RULES = [
  {
    projectNumber: PROJECT_NUMBERS[1],
    statusTrigger: "dev",
    removeLabel:   "BackLog",
    addLabel:      "Test",
  },
  {
    projectNumber: PROJECT_NUMBERS[0],
    statusTrigger: "done",
    removeLabel:   "Test",
    addLabel:      "status: done",
  },
];

async function fetchProjectItems(projectNumber) {
  const data = await gql(`
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          title
          items(first: 100) {
            nodes {
              content {
                ... on Issue { number }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field {
                      ... on ProjectV2SingleSelectField { name }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { owner: OWNER, number: projectNumber });

  const project = data.user.projectV2;
  console.log(`\nProjet #${projectNumber} — "${project.title}"`);
  return project.items.nodes;
}

async function syncProject(rule) {
  const items = await fetchProjectItems(rule.projectNumber);
  let count = 0;

  for (const item of items) {
    const issueNumber = item.content?.number;
    if (!issueNumber) continue;

    const statusField = item.fieldValues.nodes.find(
      f => f.field?.name === "Status"
    );
    const status = statusField?.name?.toLowerCase();

    if (status !== rule.statusTrigger) continue;

    const { data: issue } = await octokit.issues.get({
      owner: OWNER, repo: REPO, issue_number: issueNumber
    });

    const labels = issue.labels.map(l => l.name);
    if (!labels.includes(rule.removeLabel)) continue;

    console.log(`→ Issue #${issueNumber} : "${rule.removeLabel}" → "${rule.addLabel}"`);

    await octokit.issues.addLabels({
      owner: OWNER, repo: REPO,
      issue_number: issueNumber,
      labels: [rule.addLabel]
    });

    await octokit.issues.removeLabel({
      owner: OWNER, repo: REPO,
      issue_number: issueNumber,
      name: rule.removeLabel
    });

    console.log(`✓ Issue #${issueNumber} mise à jour`);
    count++;
  }

  return count;
}

async function main() {
  console.log(`Démarrage sync — projets : ${PROJECT_NUMBERS.join(", ")}`);
  let total = 0;

  for (const rule of RULES) {
    total += await syncProject(rule);
  }

  console.log(`\nTerminé — ${total} issue(s) mise(s) à jour au total.`);
}

main();