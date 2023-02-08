import { getConfig, multiNetworkBuild } from ".";

const VERIFIER_ADDRESS: string = "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7";

async function main() {
  const networks = await getConfig();
  const build = await multiNetworkBuild(networks, VERIFIER_ADDRESS, "6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15");
  console.log("finished build");
}

main();
