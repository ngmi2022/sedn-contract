/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import fetch from "cross-fetch";
import { BigNumber, Contract, Wallet, ethers } from "ethers";

import { FakeSigner } from "../../helper/FakeSigner";
import { sendMetaTx, sendTx } from "../../helper/signer";
import {
  checkTxStatus,
  explorerData,
  feeData,
  fetchConfig,
  getAbi,
  getRpcUrl,
  getTxCostInUSD,
  getTxReceipt,
  sleep,
} from "../../helper/utils";

// /**********************************
// INTEGRATION PARAMS / ENVIRONMENT VARIABLES
// *************************************/

const ENVIRONMENT = process.env.ENVIRONMENT || "prod";
const USE_STARGATE = process.env.USE_STARGATE === "true" ? true : false;
const signerPk = process.env.SENDER_PK || "";
const recipientPk = process.env.RECIPIENT_PK || "";
const verifierPk = process.env.VERIFIER_PK || "";
const amountEnv = process.env.AMOUNT || "1.00";

// some params & functions to facilitate metaTX testing / testnet
const gasless: boolean = process.env.CONTEXT === "github" ? true : false;
const testnet: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
// no testnets need to be included
const networksToTest = testnet ? ["arbitrum-goerli", "optimism-goerli"] : ["polygon"]; // "optimism", "arbitrum"
const destinationNetworks = ["polygon", "arbitrum"];

// necessary relayer balance for each network, NOT IN BIG NUMBER, BUT FLOATS
const minRelayerBalance: any = {
  mainnet: 0.05,
  polygon: 1,
  arbitrum: 0.01,
  "arbitrum-goerli": 0.01,
  aurora: 0.0,
  avalanche: 0.25,
  fantom: 1,
  optimism: 0.01,
  "optimism-goerli": 0.01,
};

// /**********************************
// INTEGRATION FUNCTIONS
// *************************************/

const getRandomRecipientNetwork = async (fromNetwork: string) => {
  const networks = destinationNetworks.filter(network => network !== fromNetwork);
  const randomIndex = Math.floor(Math.random() * networks.length);
  return networks[randomIndex];
};

const waitTillRecipientBalanceIncreased = async (
  maxTimeMs: number,
  contract: Contract,
  recipient: Wallet,
  initialBalance: BigNumber,
  decDivider: number,
  recipientNetwork: string,
) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const newBalance = await contract.balanceOf(recipient.address);
    const elapsedTimeMs = new Date().getTime() - startDate;

    const claimed = newBalance.sub(initialBalance).toNumber();
    if (claimed > 0) {
      return resolve(claimed);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX: Exchange took too long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(
        `TX: Waiting for recipient balance to increase. Elapsed time: ${elapsedTimeMs}ms. ${recipientNetwork}:${
          recipient.address
        } balance: ${newBalance.toNumber() / decDivider}`,
      );
      setTimeout(executePoll, 10000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

const waitTillRecipientBalanceChanged = async (
  maxTimeMs: number,
  contract: Contract,
  signer: Wallet,
  initialBalance: BigNumber,
) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const newBalance = await contract.balanceOf(signer.address);
    const elapsedTimeMs = new Date().getTime() - startDate;

    const claimed = newBalance.sub(initialBalance).toNumber();
    if (claimed != 0) {
      return resolve(claimed);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX: Exchange took too long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(
        `TX: Waiting for recipient balance to change. Elapsed time: ${elapsedTimeMs}ms. ${
          signer.address
        } balance: ${newBalance.toNumber()}`,
      );
      setTimeout(executePoll, 10000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

const checkAllowance = async (usdcOrigin: Contract, signer: Wallet, sedn: Contract, amount: number) => {
  // check allowance & if necessary increase approve
  const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
  // console.log("allowance", allowance, "vs. amount", amount);
  if (allowance < amount) {
    const increasedAllowance = amount - allowance;
    const fees = await feeData((await signer.provider.getNetwork()).name, signer);
    const approve = await usdcOrigin.connect(signer).increaseAllowance(sedn.address, increasedAllowance, {
      maxFeePerGas: fees.maxFee,
      maxPriorityFeePerGas: fees.maxPriorityFee,
    });
    await approve.wait();
    console.log("INFO: Allowance increased");
  }
  return true;
};

const checkFunding = async (
  usdcOrigin: Contract,
  signer: Wallet,
  recipient: Wallet,
  sedn: Contract,
  amount: number,
) => {
  // check and adapt funding balances of signer
  const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
  const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
  let useSigner = signer;
  let useRecipient = recipient;
  console.log(
    `INFO: Signer has ${sednBalanceSigner / 10 ** 6} USDC on sedn, Recipient has ${
      sednBalanceRecipient / 10 ** 6
    } USDC on sedn; Needed amount ${amount / 10 ** 6}`,
  );
  if (sednBalanceSigner < amount) {
    if (sednBalanceRecipient >= amount) {
      // swap signer and recipient
      useSigner = recipient;
      useRecipient = signer;
      console.log("INFO: Switched signers");
    } else {
      // check allowance & if necessary increase approve
      const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, amount); // check allowance
      const fees = await feeData((await signer.provider.getNetwork()).name, signer);
      const txSend = await sedn.connect(signer).sednKnown(amount, signer.address, {
        maxFeePerGas: fees.maxFee,
        maxPriorityFeePerGas: fees.maxPriorityFee,
      }); // fund signer w/o testing
      await txSend.wait();
      await waitTillRecipientBalanceChanged(60_000, sedn, signer, BigNumber.from(sednBalanceSigner.toString()));
      console.log("INFO: Funded signer");
    }
  }
  return [useSigner, useRecipient];
};

const generateSecret = function () {
  const solution = (Math.random() + 1).toString(36).substring(7);
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);
  return [solution, secret];
};

const generateClaimArgs = async (
  solution: string,
  secret: string,
  recipient: Wallet,
  trusted: FakeSigner,
  amount: number,
) => {
  const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
  const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipient.address, till, secret);
  const signature = ethers.utils.splitSignature(signedMessage);
  return [solution, secret, till, signature.v, signature.r, signature.s];
};

// /**********************************
// INTEGRATION TESTS
// *************************************/

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    let config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const signer = new ethers.Wallet(signerPk, provider);
    const verifier = new ethers.Wallet(verifierPk, provider);
    const recipient = new ethers.Wallet(recipientPk, provider);
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdcOrigin = new ethers.Contract(
      config.usdc[network].contract,
      await getAbi(network, config.usdc[network].abi),
      signer,
    );
    return { sedn, usdcOrigin, signer, verifier, config, recipient };
  }
  networksToTest.forEach(function (network) {
    describe(`Funding for wallets ${network}`, function () {
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let config: any;
      it(`should find relayers funded with Native and Test Wallets funded with USDC on ${network}`, async function () {
        const deployed = await getSedn(network);
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        recipient = deployed.recipient;
        config = deployed.config;

        // RELAYER CHECKS
        const relayerBalance: number = parseFloat(
          (await signer.provider.getBalance(config.relayer[network])).toString(),
        );
        // console.log("Relayer Balance", relayerBalance, minRelayerBalance[network]);
        expect(relayerBalance).to.be.gt(minRelayerBalance[network]);

        // SENDER CHECKS
        const senderBalance = await usdcOrigin.balanceOf(signer.address);
        const senderNative: number = parseFloat((await signer.provider.getBalance(signer.address)).toString());
        // console.log("Sender Balance", senderBalance.toString());
        expect(senderBalance).to.be.gt(ethers.utils.parseUnits("2", "mwei")); // TBD
        // console.log("senderNative", senderNative, minRelayerBalance[network]);
        expect(senderNative).to.be.gt(minRelayerBalance[network]);

        // RECIPIENT CHECKS
        const recipientBalance = await usdcOrigin.balanceOf(recipient.address);
        const recipientNative: number = parseFloat((await signer.provider.getBalance(recipient.address)).toString());
        // console.log("recipient Balance", recipientBalance.toString());
        // expect(recipientBalance).to.be.gt(ethers.utils.parseUnits("0", "mwei")); // TBD
        // console.log("recipientNative", recipientNative, minRelayerBalance[network]);
        expect(recipientNative).to.be.gt(minRelayerBalance[network]);
      });
    });
  });
  networksToTest.forEach(function (network) {
    describe(`Sedn on ${network}`, function () {
      let sedn: Contract;
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let trusted: FakeSigner;
      let config: any;
      let decDivider: number;
      let amount: number;
      let relayerWebhook: string;
      let forwarder: string;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        config = deployed.config;
        recipient = deployed.recipient;
        decDivider = parseInt(10 ** (await usdcOrigin.decimals()) + "");
        amount = parseInt(parseFloat(amountEnv) * decDivider + "");
        relayerWebhook = config.relayerWebhooks[network];
        forwarder = config.forwarder[network];

        trusted = new FakeSigner(deployed.verifier, sedn.address);
        if (trusted.getAddress() !== deployed.config.verifier) {
          const error = new Error(
            `Using the wrong verifier: expected ${deployed.config.verifier} got ${trusted.getAddress()}`,
          );
          console.error(error);
          throw error;
        }
      });
      it("should send funds to a registered user", async function () {
        // check allowance & if necessary increase approve
        const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, amount);

        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address); // should be at least 10
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
        // TODO: put this shit in helper so its not duplicated
        const fees = await feeData((await signer.provider.getNetwork()).name, signer);
        const tx = await sedn.connect(signer).sednKnown(amount, signer.address, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        }); // send amount to signer itself
        await tx.wait();
        // for some reason the usdcBalance does not update quickly enough
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednAfterSednSigner = await sedn.balanceOf(signer.address);

        // all three balances are checked; contract USDC, signer USDC and signer Sedn
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
        expect(sednAfterSednSigner.sub(sednBeforeSednSigner)).to.equal(amount);
      });
      it("should send funds to an unregistered user", async function () {
        // check allowance & if necessary increase approve
        const allowanceChecked = await checkAllowance(usdcOrigin, signer, sedn, amount);

        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeClaimRecipient = await sedn.balanceOf(recipient.address);
        const [solution, secret] = generateSecret();

        // always gasfull
        const fees = await feeData((await signer.provider.getNetwork()).name, signer);
        const txSedn = await sedn.connect(signer).sednUnknown(amount, secret, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        });
        const txReceipt = await txSedn.wait();
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, signer, usdcBeforeSednSigner);
        // check sending
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);

        // claim
        const funcArgsTwo = await generateClaimArgs(solution, secret, recipient, trusted, amount);
        // TODO: get this shit into signer.ts
        const txReceiptTwo = await sendTx(
          sedn,
          recipient,
          recipient.privateKey,
          "claim",
          funcArgsTwo,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, recipient, sednBeforeClaimRecipient);

        // check claim
        const sednAfterClaimRecipient = await sedn.balanceOf(recipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to an unregistered user", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const [solution, secret] = generateSecret();
        const funcArgs = [amount, secret];
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "transferUnknown",
          funcArgs,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useSigner, sednBeforeTransferSigner);

        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);

        // claim
        const sednBeforeClaimRecipient = await sedn.balanceOf(useRecipient.address);
        const funcArgsTwo = await generateClaimArgs(solution, secret, useRecipient, trusted, amount);
        // TODO: get this shit into signer.ts
        const txReceiptTwo = await sendTx(
          sedn,
          useRecipient,
          useRecipient.privateKey,
          "claim",
          funcArgsTwo,
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useRecipient, sednBeforeClaimRecipient);
        const sednAfterClaimRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to a registered user", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednBeforeTransferRecipient = await sedn.balanceOf(useRecipient.address);
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "transferKnown",
          [amount, useRecipient.address],
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, sedn, useSigner, sednBeforeTransferSigner);
        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednAfterTransferRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);
        expect(sednAfterTransferRecipient.sub(sednBeforeTransferRecipient)).to.equal(amount);
      });
      it("should withdraw funds to a given address", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // withdraw
        const sednBeforeWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcBeforeWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        // TODO: get this shit into signer.ts
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "withdraw",
          [amount, useSigner.address],
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await waitTillRecipientBalanceChanged(60_000, usdcOrigin, useSigner, usdcBeforeWithdrawSigner);
        const sednAfterWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcAfterWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        expect(sednBeforeWithdrawSigner.sub(sednAfterWithdrawSigner)).to.equal(amount);
        expect(usdcAfterWithdrawSigner.sub(usdcBeforeWithdrawSigner)).to.equal(amount);
      });
      // we need to figure out how we can specify the "only" keyword for a
      // single test on live-chains to ensure that we don't piss too much gas
      it("should send funds to an unregistered user who claims it on a different chain", async function () {
        // check and adapt funding balances of signer
        let [useSigner, useRecipient] = await checkFunding(usdcOrigin, signer, recipient, sedn, amount);

        // /**********************************
        // Setup of DESTINATION
        // *************************************/
        const destinationNetwork = testnet ? network : await getRandomRecipientNetwork(network); // only test on testnet as no bridges possible
        const destinationProvider = new ethers.providers.JsonRpcProvider(getRpcUrl(destinationNetwork));
        const destinationRecipient = new ethers.Wallet(useSigner.privateKey, destinationProvider);
        const usdcDestination = new ethers.Contract(
          config.usdc[destinationNetwork].contract,
          await getAbi(destinationNetwork, config.usdc[destinationNetwork].abi),
          destinationRecipient,
        );

        console.log(
          `INFO: Withdrawing ${amount / decDivider} USDC from SednBalance of ${useSigner.address} (${network}) to ${
            destinationRecipient.address
          } (${destinationNetwork})`,
        );

        // /**********************************
        // Get the Bungee/Socket Route
        // *************************************/

        // GATEKEEPER FOR STARGATE
        let excludeBridges = "stargate";
        if (amount > 10 ** decDivider) {
          excludeBridges = "";
        }

        const socketRouteRequest = {
          fromChain: testnet ? "polygon" : network,
          toChain: testnet ? "arbitrum" : destinationNetwork,
          recipientAddress: destinationRecipient.address,
          amount: amount / decDivider,
          excludeBridges: excludeBridges,
          useStargate: USE_STARGATE,
          environment: ENVIRONMENT,
        };

        const cloudFunctionUrl = "https://us-central1-sedn-17b18.cloudfunctions.net/getSednParameters/";
        // const cloudFunctionUrl = "http://127.0.0.1:5001/sedn-17b18/us-central1/getSednParameters";

        const socketRouteResponse: any = await fetch(cloudFunctionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ data: socketRouteRequest }),
        });
        const socketRoute = (await socketRouteResponse.json()).result;
        console.log("INFO: Socket Route");
        console.log("INFO: -- URL used:", cloudFunctionUrl);
        console.log("INFO: -- Args sent:", JSON.stringify(socketRouteRequest));
        console.log("INFO: -- Response:");
        console.log("INFO: ---- UserRequest:");
        console.log("INFO: ------ receiverAddress:", socketRoute.request.receiverAddress);
        console.log("INFO: ------ toChainId:", socketRoute.request.toChainId);
        console.log("INFO: ------ amount:", socketRoute.request.amount);
        console.log("INFO: ------ bridgeAddress:", socketRoute.bridgeAddress);
        console.log("INFO: ------ middlewareRequest:", JSON.stringify(socketRoute.request.middlewareRequest));
        console.log("INFO: ------ bridgeRequest:", JSON.stringify(socketRoute.request.bridgeRequest));
        console.log("INFO: ---- bridgeAddress:", socketRoute.bridgeAddress);
        console.log("INFO: ---- Value:", socketRoute.value);

        // create calldata dict
        const bungeeUserRequestDict = socketRoute.request;
        const bungeeBridgeAddress: string = socketRoute.bridgeAddress;
        const bungeeValue: BigInt = socketRoute.value;

        // stamping and sharing info
        const sednOriginBeforeWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcOriginBeforeWithdrawContract = await usdcOrigin.balanceOf(sedn.address);
        const usdcDestinationBeforeWithdrawSigner = await usdcDestination.balanceOf(useSigner.address);
        console.log(
          `ACCOUNTS: SednSigner inital state (${network}:${useSigner.address}) ${
            sednOriginBeforeWithdrawSigner.toNumber() / decDivider
          }`,
        );
        console.log(
          `ACCOUNTS: Sedn USDCbalance initial state (${network}:${sedn.address}) ${
            usdcOriginBeforeWithdrawContract.toNumber() / decDivider
          }`,
        );

        // --------------------------
        // WITHDRAW
        // --------------------------
        const txReceipt = await sendTx(
          sedn,
          useSigner,
          useSigner.privateKey,
          "bridgeWithdraw",
          [amount, bungeeUserRequestDict, bungeeBridgeAddress],
          BigInt("0"),
          network,
          gasless,
          relayerWebhook,
          forwarder,
        );
        await checkTxStatus(txReceipt);

        // wait for shit to happen
        await waitTillRecipientBalanceIncreased(
          50 * 60_000,
          usdcDestination,
          destinationRecipient,
          usdcDestinationBeforeWithdrawSigner,
          decDivider,
          destinationNetwork,
        );
        const usdcDestinationAfterWithdrawSigner = await usdcDestination.balanceOf(destinationRecipient.address);
        console.log(
          `ACCOUNTS: RecipientDestination balance after 'claim' (${destinationNetwork}:${
            destinationRecipient.address
          }) ${usdcDestinationAfterWithdrawSigner.toNumber() / decDivider}`,
        );
        const claimedAmount =
          usdcDestinationAfterWithdrawSigner.sub(usdcDestinationBeforeWithdrawSigner).toNumber() / decDivider;
        const bridgeFees = amount / decDivider - claimedAmount;
        console.log(
          `INFO: Claimed ${claimedAmount} with bridge fees of ${bridgeFees} (${
            (bridgeFees / (amount / decDivider)) * 100
          }%). Sent ${amount / decDivider} and received ${claimedAmount}`,
        );
      });
    });
  });
});
