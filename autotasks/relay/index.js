import { DefenderRelayProvider, DefenderRelaySigner } from "defender-relay-client/lib/ethers";
import { Contract } from "ethers";

import { ForwarderAbi } from "../../gasless/forwarder";
import { forwarderAddressBook } from "../../gasless/addresses"


async function relay(forwarder, request, signature) {
  // Validate request on the forwarder contract
  const valid = await forwarder.verify(request, signature);
  if (!valid) throw new Error(`Invalid request`);

  // Send meta-tx through relayer to the forwarder contract
  const gasLimit = (parseInt(request.gas) + 50000).toString();
  return await forwarder.execute(request, signature, { gasLimit });
}

async function handler(event) {
  // Parse webhook payload
  if (!event.request || !event.request.body) throw new Error(`Missing payload`);
  const { request, signature } = event.request.body;
  console.log(`Relaying`, request);

  // Initialize Relayer provider and signer, and forwarder contract
  const credentials = { ...event };
  const provider = new DefenderRelayProvider(credentials);
  // get chain id for multichain functionality
  const networkName = (await provider.getNetwork()).name;
  const ForwarderAddress = forwarderAddressBook[networkName]["MinimalForwarder"];
  const signer = new DefenderRelaySigner(credentials, provider, { speed: "fast" });
  const forwarder = new Contract(ForwarderAddress, ForwarderAbi, signer);

  // Relay transaction!
  const tx = await relay(forwarder, request, signature);
  console.log(`Sent meta-tx: ${tx.hash}`);
  return { txHash: tx.hash };
}

export default {
  handler,
  relay,
};
