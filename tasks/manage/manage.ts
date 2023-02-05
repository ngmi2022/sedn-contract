import { run, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface INetworksDeploy {
  [network: string]: {
    testnet: boolean;
    usdcAddress?: string;
    forwarderAddress?: string;
  };
}

export interface INetworksUpgrade {
  [network: string]: {
    testnet: boolean;
    proxyAddress: string;
    implementationAddress: string;
    forwarderAddress: string;
  };
}

export async function deployForwarder(network: string): Promise<string> {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const forwarderAddress = await run("deploy:forwarder", { hre });
  return forwarderAddress;
}

export async function deploySedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress, proxyAddress } = await run("deploy:Sedn", {
    hre,
    upgrades,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function upgradeSedn(network: string, proxyAddress: string, forwarderAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress } = await run("upgrade:Sedn", {
    hre,
    upgrades,
    proxyAddress,
    forwarderAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestnetSedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress, proxyAddress } = await run("deploy:testnet", {
    hre,
    upgrades,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function upgradeTestnetSedn(network: string, proxyAddress: string, forwarderAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress } = await run("upgrade:testnet", {
    hre,
    upgrades,
    proxyAddress,
    forwarderAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestUSDC(network: string, amountToDeploy: number) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const usdcAddress = await run("deploy:usdc", { hre, amountToDeploy });
  return usdcAddress;
}

export async function deploySednWithForwarder(
  network: string,
  usdcAddress: string,
  verifierAddress: string,
  testnet: boolean,
) {
  // deploy forwarder
  const forwarderAddress = await deployForwarder(network);
  let addresses: any = {
    implementationAddress: "",
    proxyAddress: "",
  };
  if (testnet) {
    addresses = await deployTestnetSedn(network, forwarderAddress, verifierAddress, usdcAddress);
  } else {
    addresses = await deploySedn(network, forwarderAddress, verifierAddress, usdcAddress);
  }
  console.log("Sedn deployed to: ", addresses.proxyAddress);
  console.log("Implementation contract deployed to: ", addresses.implementationAddress);
  console.log("Forwarder deployed to: ", forwarderAddress);
  console.log("Process finished");
  return {
    implementationAddress: addresses.implementationAddress,
    proxyAddress: addresses.proxyAddress,
    forwarderAddress,
  };
}

export async function deploySednWithAll(network: string, verifierAddress: string, testnet: boolean) {
  // deploy usdc (typically only for testnet)
  const usdcAddress = await deployTestUSDC(network, 100000000);
  console.log("USDC deployed to: ", usdcAddress);
  // deploy forwarder
  const { implementationAddress, proxyAddress, forwarderAddress } = await deploySednWithForwarder(
    network,
    usdcAddress,
    verifierAddress,
    testnet,
  );
  return { implementationAddress, proxyAddress, forwarderAddress, usdcAddress };
}

export async function multiNetworkSednDeploy(networksToDeploy: INetworksDeploy, verifierAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  const networks = Object.keys(networksToDeploy);
  const networksHRE = Object.keys(hre.config.networks);
  checkMissingNetworks(networks, networksHRE);
  console.log("HRE networks available:", networksHRE.join(", "));

  let config: INetworksUpgrade = {};
  for (const network of networks) {
    const { testnet, usdcAddress } = networksToDeploy[network];
    const { implementationAddress, proxyAddress, forwarderAddress } = await deploySednWithForwarder(
      network,
      usdcAddress!,
      verifierAddress,
      testnet,
    );
    config[network] = {
      testnet,
      implementationAddress,
      proxyAddress,
      forwarderAddress,
    };
  }
  console.log(config);
  return config;
}

function checkMissingNetworks(networks: string[], networksHRE: string[]) {
  const missingNetworks = networks.filter(network => !networksHRE.includes(network));
  if (missingNetworks.length) {
    const errorMessage = `The following networks are not available in config: ${missingNetworks.join(", ")}`;
    throw new Error(errorMessage);
  }
}

const NETWORKS: INetworksDeploy = {
  "arbitrum-goerli": {
    testnet: true,
    usdcAddress: "0xa30d67979d4ce07b5467533b633ad23285434c4a",
    forwarderAddress: "0x47b80475A1A4832a0dcbBc206E24Ddf6533aE2Bb",
  },
  // "optimism-goerli": {
  //   testnet: true,
  //   usdcAddress: "0x8DC32778b81f7C2A537647CCf7fac2F8BC713f9C",
  // },
};

const VERIFIED_ADDRESS = "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7";
const NETWORK = "arbitrum-goerli";

async function manualDeploy(network: string, networksToDeploy: INetworksDeploy, verifierAddress: string) {
  const { usdcAddress, forwarderAddress } = networksToDeploy[network];
  const config = await deployTestnetSedn(network, forwarderAddress!, verifierAddress, usdcAddress!);
  console.log(JSON.stringify(config));
  return;
}

// manualDeploy(NETWORK, NETWORKS, VERIFIED_ADDRESS);

const PROXY_ADDRESS = "0x2eECe520fB6d83582DD78056565951A4A7cB6743";

async function manualUpgrade(network: string, proxyAddress: string, forwarderAddress: string) {
  const { implementationAddress } = await upgradeTestnetSedn(network, proxyAddress, forwarderAddress);
  console.log("New implementation address: ", implementationAddress);
  return;
}

manualUpgrade(NETWORK, PROXY_ADDRESS, "0x47b80475A1A4832a0dcbBc206E24Ddf6533aE2Bb");
