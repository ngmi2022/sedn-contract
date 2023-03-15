import { forceImportForBuild } from ".";

async function main() {
  const buildUid = "6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15";
  const build = await forceImportForBuild(buildUid);
  console.log("finished build");
  return;
}

main();
