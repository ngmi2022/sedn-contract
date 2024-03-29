import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { Contract, BigNumber, ethers, Wallet } from "ethers";

import { ForwarderAbi } from "../../abis/abis";

const configData = async (environment) => {
  if (environment === "staging") {
    const configData = await (await fetch("https://storage.googleapis.com/sedn-config-public/v2.staging.config.json?avoidTheCaches=1")).json();
    return configData;
  }
  const configData = await (await fetch("https://storage.googleapis.com/sedn-config-public/v2.config.json?avoidTheCaches=1")).json();
  return configData;
};

const getRpcUrl = (network) => {
  switch (network) {
    case "mainnet":
      return "https://mainnet.infura.io/v3/" + infuraKey;
    case "matic":
    case "polygon-mainnet":
    case "polygon":
      return "https://polygon-mainnet.infura.io/v3/" + infuraKey;
    case "arbitrum":
      return "https://arbitrum-mainnet.infura.io/v3/" + infuraKey;
    case "arbitrum-goerli":
      return "https://arbitrum-goerli.infura.io/v3/" + infuraKey;
    case "optimism":
      return "https://optimism-mainnet.infura.io/v3/" + infuraKey;
    case "optimism-goerli":
      return "https://optimism-goerli.infura.io/v3/" + infuraKey;
    default:
      throw new Error("Network not supported: create new Quicknode endpoint and add rpc url");
  }
};

async function relay(forwarder, request, signature) {
  // Validate request on the forwarder contract
  const valid = await forwarder.verify(request, signature);
  if (!valid) throw new Error(`Invalid request`);

  // Send meta-tx through relayer to the forwarder contract
  const gasEstimate = await forwarder.estimateGas.execute(request, signature);
  console.log(gasEstimate)
  const gasLimit = gasEstimate.add(BigNumber.from("1000000"));
  const value = (parseInt(request.value)).toString();
  console.log(`Using gas limit ${gasLimit.toString()}`);
  return await forwarder.execute(request, signature, { gasLimit, value });
}

async function handler(event) {
  const environment = event.autotaskName.toLowerCase().includes("staging") ? "staging" : "prod";
  console.log(`Autotask name: ${event.autotaskName} (${event.autotaskId}) - Run ID: ${event.autotaskRunId} (environment: ${environment})`);
  const config = await configData(environment);
  // Parse webhook payload
  if (!event.request || !event.request.body || !event.request.body.request || !event.request.body.signature) throw new Error(`Missing payload`);
  const { request, signature } = event.request.body;
  console.log(`Relaying`, JSON.stringify(request));

  // HOTFIX START >>
  // Initialize Relayer provider and signer, and forwarder contract
  const credentials = { ...event };
  // lets check what OZ is using
  const provider = new DefenderRelayProvider(credentials);
  // get chain id for multichain functionality
  const { chainId, name } = await provider.getNetwork();
  const networkName = chainId == 421613 ? "arbitrum-goerli" : name;
  console.log("INFO: OZ chainId", chainId, "name", networkName);
  // get our provider
  const newProvider = new ethers.providers.JsonRpcProvider(getRpcUrl(networkName));
  // << HOTFIX END

  const forwarderAddress = config.forwarder[networkName];
  console.log("forwarder address", forwarderAddress);
  const signer = new DefenderRelaySigner(credentials, newProvider, { speed: "fast" });
  const forwarder = new Contract(forwarderAddress, ForwarderAbi, signer);

  // Relay transaction!
  console.log(`Relaying transaction via ${forwarderAddress} by ${signer.address}`);
  const tx = await relay(forwarder, request, signature);
  console.log(`Sent meta-tx: ${tx.hash}`);
  return { txHash: tx.hash };
}

export default {
  handler,
  relay,
};
