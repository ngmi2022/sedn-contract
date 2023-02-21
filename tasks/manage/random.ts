import { TransactionRequest } from "@ethersproject/providers";
import { ethers } from "ethers";

import { feeData, getRpcUrl } from "../../helper/utils";

const MNEMONIC = process.env.MNEMONIC!;

async function killTxs(network: string, nonces: number[]) {
  const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
  const signer = ethers.Wallet.fromMnemonic(MNEMONIC).connect(provider);
  const fees = await feeData(network, signer);
  const currentNonce = await signer.getTransactionCount();
  const feesOld = await provider.getFeeData();
  console.log("Current nonce:", currentNonce);
  for (const nonce of nonces) {
    console.log("Killing tx with nonce:", nonce);
    console.log("Gas fees", fees.maxFee!.mul(2).toString(), fees.maxPriorityFee!.mul(2).toString());
    console.log(
      "Gas Fees old,",
      feesOld.maxFeePerGas!.mul(2).toString(),
      feesOld.maxPriorityFeePerGas!.mul(2).toString(),
      feesOld.gasPrice!.mul(2),
    );
    const tx: TransactionRequest = {
      data: "0x",
      nonce: nonce,
      maxPriorityFeePerGas: fees.maxPriorityFee!.mul(4),
      maxFeePerGas: fees.maxFee!.mul(4),
    };
    signer.sendTransaction(tx);
  }
}

killTxs("polygon-mainnet", [163, 164, 165, 166]);
