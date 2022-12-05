import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { Contract } from "ethers";

import { ForwarderAbi } from "../../abis/abis";

const configData = async () => {
  const configData = await (await fetch("https://storage.googleapis.com/sedn-public-config/config.json")).json();
  return configData;
};

async function relay(forwarder, request, signature) {
  // Validate request on the forwarder contract
  const valid = await forwarder.verify(request, signature);
  if (!valid) throw new Error(`Invalid request`);

  // Send meta-tx through relayer to the forwarder contract
  const gasLimit = (parseInt(request.gas) + 1000000).toString();
  const value = (parseInt(request.value)).toString();
  console.log(`Using gas limit ${gasLimit}`);
  return await forwarder.execute(request, signature, { gasLimit, value });
}

async function handler(event) {
  const config = await configData();
  // Parse webhook payload
  if (!event.request || !event.request.body) throw new Error(`Missing payload`);
  const { request, signature } = event.request.body;
  console.log(`Relaying`, request);

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
