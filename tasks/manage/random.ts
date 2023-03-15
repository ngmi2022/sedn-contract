async function verify(address: string, constructorArgs: string[], network: string) {
  const hre = require("hardhat");
  hre.changeNetwork(network);
  await hre.run("verify:verify", {
    address: address,
    constructorArguments: constructorArgs,
  });
}

verify("0x40E67AFad48D67b05f0A41F1c5ca2faD36CAe045", ["0xEd02391B5EAC1A313dEd1d0525De2a2A0E891ade"], "polygon-mainnet");
