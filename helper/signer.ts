import { TypedDataDomain, TypedDataField } from "@ethersproject/abstract-signer";
import { arrayify, hexConcat } from "@ethersproject/bytes";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { hashMessage } from "@ethersproject/hash";
import { keccak256 } from "@ethersproject/keccak256";
import { fetch } from "cross-fetch";
import { Contract, Signer, Wallet, ethers } from "ethers";

import { ForwarderAbi } from "../abis/abis";
import { explorerData, feeData, getChainId, getTxCostInUSD, getTxReceipt } from "./utils";

function getMetaTxTypeData(verifyingContract: string) {
  const ForwardRequest = [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "chainid", type: "uint256" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "valid", type: "uint256" },
    { name: "data", type: "bytes" },
  ] as TypedDataField[];
  const typedDomain: TypedDataDomain = {
    name: "SednForwarder",
    version: "0.0.2",
    verifyingContract,
  };
  const types = {
    ForwardRequest,
  } as Record<string, TypedDataField[]>;
  return {
    types,
    domain: typedDomain,
    primaryType: "ForwardRequest",
  };
}

async function buildRequest(forwarder: ethers.Contract, input: { [key: string]: string | number }) {
  const nonce = await forwarder.getNonce(input.from).then(nonce => nonce.toString());
  return {
    from: input.from,
    to: input.to,
    chainid: input.chainid,
    value: input.value,
    gas: 1e6,
    nonce,
    valid: input.valid,
    data: input.data,
  };
}

function buildTypedData(forwarderAddress: string) {
  const typeData = getMetaTxTypeData(forwarderAddress);
  return { ...typeData };
}

export async function signMetaTxRequest(
  signer: Wallet,
  forwarder: Contract,
  input: { [key: string]: string | number },
) {
  const request = await buildRequest(forwarder, input);
  const toSign = buildTypedData(forwarder.address);
  const signature = await signer._signTypedData(toSign.domain, toSign.types, request);
  console.log("publicKey derived: ", getPublicKeyFromSignature(signature, request, forwarder.address));
  return { signature, request };
}

export function getPublicKeyFromSignature(signature: string, request: any, forwarderAddress: string) {
  let typedData = buildTypedData(forwarderAddress);
  const recoveredPubKey = ethers.utils.verifyTypedData(typedData.domain, typedData.types, request, signature);
  return recoveredPubKey.toLowerCase();
}

export async function getSignedTxRequest(
  sednContract: Contract,
  signer: Wallet,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainId: number,
  validUntilTime: number,
  forwarderAddress: string,
) {
  const forwarder = new ethers.Contract(forwarderAddress, ForwarderAbi, signer);
  const from = await signer.getAddress();
  const data = sednContract.interface.encodeFunctionData(funcName, funcArgs);
  const to = sednContract.address;
  const value = txValue.toString();
  const valid = validUntilTime.toString();
  const chainid = chainId.toString();

  const request = await signMetaTxRequest(signer, forwarder, { from, to, chainid, value, valid, data });
  return request;
}

export async function sendMetaTx(
  sednContract: Contract,
  signer: Wallet,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainId: number,
  validUntilTime: number,
  relayerWebhook: string,
  forwarderAddress: string,
) {
  const request = await getSignedTxRequest(
    sednContract,
    signer,
    funcName,
    funcArgs,
    txValue,
    chainId,
    validUntilTime,
    forwarderAddress,
  );
  const response = await fetch(relayerWebhook, {
    method: "POST",
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json", "Accept-Encoding": "identity" },
  }).then(function (res) {
    return res.json();
  });
  return response;
}

export async function sendTx(
  contract: Contract,
  signer: Wallet,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  network: string,
  validUntilTime: number,
  gasless: boolean,
  relayerWebhook?: string,
  forwarderAddress?: string,
) {
  let txReceipt: any = null;
  let txHash: string = "";
  let chainId = parseInt(getChainId(network));
  if (gasless) {
    if (!relayerWebhook) throw new Error(`Missing relayer webhook url`);
    if (!forwarderAddress) throw new Error(`Missing forwarder address`);
    const response = await sendMetaTx(
      contract,
      signer,
      funcName,
      funcArgs,
      txValue,
      chainId,
      validUntilTime,
      relayerWebhook,
      forwarderAddress,
    );
    txHash = JSON.parse(response.result).txHash;
    console.log(`TX: Send gasless tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await getTxReceipt(60_000, signer, txHash);
  } else {
    let fees = await feeData(network, signer);
    const lenfuncArgs = funcArgs.push({ maxFeePerGas: fees.maxFee, maxPriorityFeePerGas: fees.maxPriorityFee });
    const tx = await contract.connect(signer).functions[funcName](...funcArgs);
    txHash = tx.hash;
    console.log(`TX: Send tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await tx.wait();
  }
  console.log(`TX: Executed send tx with txHash: ${txHash}`);
  console.log(`TX: Dollar cost: ${await getTxCostInUSD(txReceipt, network)}`);
  return txReceipt;
}

module.exports = {
  signMetaTxRequest,
  getSignedTxRequest,
  buildRequest,
  buildTypedData,
  sendMetaTx,
  sendTx,
};
