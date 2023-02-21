import { getConfig, multiNetworkBuild } from ".";

const VERIFIER_ADDRESS: string = "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7";

async function main() {
  const networks = await getConfig();
  const build = await multiNetworkBuild(networks, VERIFIER_ADDRESS, "6762cb50-a25d-4a68-a455-932fba6d1712");
  console.log("finished build");
}

main();
