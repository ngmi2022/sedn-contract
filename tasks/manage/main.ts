import { getConfig, multiNetworkBuild } from ".";

const VERIFIER_ADDRESS: string = "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7";

async function main() {
  const networks = await getConfig();
  const build = await multiNetworkBuild(networks, VERIFIER_ADDRESS, "69125ab6-5aae-46cc-9e67-f612f55b8185");
  console.log("finished build");
}

main();
