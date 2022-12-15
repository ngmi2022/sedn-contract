import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { Contract, BigNumber } from "ethers";

import { ForwarderAbi } from "../../abis/abis";

const configData = async (environment) => {
  if (environment === "staging") {
    const configData = await (await fetch("https://storage.googleapis.com/sedn-public-config/v2.staging.config.json?avoidTheCaches=1")).json();
    return configData;
  }
  const configData = await (await fetch("https://storage.googleapis.com/sedn-public-config/v2.config.json?avoidTheCaches=1")).json();
  return configData;
};

async function relay(forwarder, request, signature) {
  // Validate request on the forwarder contract
  const valid = await forwarder.verify(request, signature);
  if (!valid) throw new Error(`Invalid request`);

  // Send meta-tx through relayer to the forwarder contract
  const gasEstimate = await forwarder.estimateGas.execute(request, signature);
  console.log(gasEstimate)
  const gasLimit = gasEstimate.add(BigNumber.from("4000000"));
  const value = (parseInt(request.value)).toString();
  console.log(`Using gas limit ${gasLimit.toString()}`);
  return await forwarder.execute(request, signature, { gasLimit, value });
}

async function handler(event) {
  const environment = event.autotaskName.toLowerCase().includes("staging") ? "staging" : "prod";
  console.log(`Autotask name: ${event.autotaskName} (${event.autotaskId}) - Run ID: ${event.autotaskRunId} (environment: ${environment})`);
  const config = await configData(environment);
  // Parse webhook payload
  if (!event.request || !event.request.body) throw new Error(`Missing payload`);
  const { request, signature } = event.request.body;
  console.log(`Relaying`, JSON.stringify(request));

  // Initialize Relayer provider and signer, and forwarder contract
  const credentials = { ...event };
  const provider = new DefenderRelayProvider(credentials);
  // get chain id for multichain functionality
  const { chainId, name } = await provider.getNetwork();
  const networkName = chainId == 421613 ? "arbitrum-goerli" : name;
  const forwarderAddress = config.forwarder[networkName];
  console.log("forwarder address", forwarderAddress);
  const signer = new DefenderRelaySigner(credentials, provider, { speed: "fast" });
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
