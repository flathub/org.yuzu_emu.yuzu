// Note: This is a GitHub Actions script
// It is not meant to be executed directly on your machine without modifications

const fs = require("fs");

const check_query = `query($name: String!){
  repository(name: $name, owner: "flathub") {
    pullRequests(states: OPEN, first: 50, baseRefName: "master", orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        id number headRefName mergeable
        author { login }
      }
    }
  }
}`;

const close_pr_mutation = `mutation cpm_{num} {
  closePullRequest(input: {pullRequestId: "{id}"}) { clientMutationId }
}`;

async function closePullRequests(should_close, github) {
  if (should_close.length > 0) {
    console.log("Closing other pull requests ...");
    let mut = "";
    for (let i = 0; i < should_close.length; i++) {
      mut += close_pr_mutation
        .replace("{num}", i)
        .replace("{id}", should_close[i].id);
      mut += "\n";
    }
    await github.graphql(mut);
    console.log("Pull requests closed.");
  }
}

async function incrementVersion() {
  const manifest = fs.readFileSync("org.yuzu_emu.yuzu.json", {
    encoding: "utf8",
  });
  const version = /mainline-0-(\d+)/.exec(manifest)[1];
  const new_manifest = manifest
    .replace(/-DDISPLAY_VERSION=\d+/, `-DDISPLAY_VERSION=${version}`)
    .replace(/-DBUILD_TAG=mainline-\d+/, `-DBUILD_TAG=mainline-${version}`);
  fs.writeFileSync("org.yuzu_emu.yuzu.json", new_manifest);
}

async function mergeChanges(branch, execa) {
  try {
    const p = execa("git", ["merge", "--ff-only", `origin/${branch}`]);
    p.stdout.pipe(process.stdout);
    await p;
    // bump the version number
    await incrementVersion();
    await execa("git", ["add", "org.yuzu_emu.yuzu.json"]);
    // amend the commit to include the version change
    const p1 = execa("git", ["commit", "--amend"]);
    p1.stdout.pipe(process.stdout);
    await p1;
  } catch (err) {
    console.log(
      `::error title=Merge failed::Failed to merge pull request: ${err}`
    );
    return;
  }

  const p = execa("git", ["push", "origin", `master:${branch}`, "-f"]);
  p.stdout.pipe(process.stdout);
  await p;
  await new Promise((r) => setTimeout(r, 2000));
  // wait a while for GitHub to process the pull request update
  const p1 = execa("git", ["push", "origin"]);
  p1.stdout.pipe(process.stdout);
  await p1;
}

async function checkChanges(github, context) {
  const variables = {
    name: context.repo.repo,
  };
  const result = await github.graphql(check_query, variables);
  const prs = result.repository.pullRequests.nodes;
  const auto_prs = prs.filter(
    (pr) => pr.author.login === "flathubbot" && pr.mergeable === "MERGEABLE"
  );
  if (auto_prs.length < 1) {
    console.warn("No pull requests available for merge.");
    return null;
  }
  const chosen = auto_prs[0];
  const should_close = auto_prs.slice(1);
  console.log(`Selected pull request: #${chosen.number}`);
  await closePullRequests(should_close, github);
  return chosen.headRefName;
}

module.exports.checkChanges = checkChanges;
module.exports.mergeChanges = mergeChanges;
