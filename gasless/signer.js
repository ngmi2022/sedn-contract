import { signTypedData, SignTypedDataVersion } from "@metamask/eth-sig-util";

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const ForwardRequest = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" },
];

function getMetaTxTypeData(chainId, verifyingContract) {
  return {
    types: {
      EIP712Domain,
      ForwardRequest,
    },
    domain: {
      name: "MinimalForwarder",
      version: "0.0.1",
      chainId,
      verifyingContract,
    },
    primaryType: "ForwardRequest",
  };
}

// async function signTypedData(signer, from, data) {
//   // If signer is a private key, use it to sign
//   if (typeof signer === "string") {
//     const privateKey = Buffer.from(signer.replace(/^0x/, ""), "hex");
//     const version = SignTypedDataVersion.V4
//     return signTypedData(privateKey, { data }, version);
//   }

//   // Otherwise, send the signTypedData RPC call
//   // Note that hardhatvm and metamask require different EIP712 input
//   console.log(data.domain.chainId)
//   const isHardhat = data.domain.chainId == 31337;
//   const [method, argData] = isHardhat ? ["eth_signTypedData", data] : ["eth_signTypedData", JSON.stringify(data)];
//   return await signer.send(method, [from, argData]);
// }

async function buildRequest(forwarder, input) {
  const nonce = await forwarder.getNonce(input.from).then(nonce => nonce.toString());
  return { value: 0, gas: 1e6, nonce, ...input };
}

async function buildTypedData(forwarder, request) {
  const chainId = await forwarder.provider.getNetwork().then(n => n.chainId);
  const typeData = getMetaTxTypeData(chainId, forwarder.address);
  return { ...typeData, message: request };
}

export async function signMetaTxRequest(signer, forwarder, input) {
  console.log(1);
  const request = await buildRequest(forwarder, input);
  console.log(2);
  const toSign = await buildTypedData(forwarder, request);
  console.log(3);
  const privateKey = Buffer.from(signer.replace(/^0x/, ""), "hex");
  const signature = signTypedData({ privateKey, data: toSign, version: SignTypedDataVersion.V3 });
  console.log(4);
  return { signature, request };
}

module.exports = {
  signMetaTxRequest,
  buildRequest,
  buildTypedData,
};
