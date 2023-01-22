/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { BigNumber, ethers } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import * as admin from "firebase-admin";
import {
  ChainId,
  Environment,
  IClaimRequest,
  IExecuteTransactionsRequest,
  IExecutionsResponse,
  ITransaction,
  IWireRequest,
  IWireResponse,
  IWithdrawRequest,
  TransactionType,
} from "sedn-interfaces";

import { FakeSigner } from "../../helper/FakeSigner";
import { createUserAndGenerateIdToken, deleteAccountsForAnyUIDs } from "../../helper/authUtils";
import {
  INetworkScenarios,
  apiCall,
  createFundingScenario,
  fetchConfig,
  getAbi,
  getBalance,
  getChainFromId,
  getChainId,
  getRpcUrl,
  handleTxSignature,
  instantiateFundingScenario,
  sleep,
  waitTillRecipientBalanceChanged,
} from "../../helper/utils";

// /**********************************
// INTEGRATION PARAMS / ENVIRONMENT VARIABLES
// *************************************/

const TESTNET: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
const deployedNetworks = TESTNET ? ["arbitrum-goerli", "optimism-goerli"] : ["arbitrum", "optimism", "polygon"]; // "optimism", "arbitrum"
let ENVIRONMENT = process.env.ENVIRONMENT || "prod";
const SIGNER_PK = process.env.SENDER_PK!;
const RECIPIENT_PK = process.env.RECIPIENT_PK!;
const UNFUNDED_SIGNER_PK = process.env.UNFUNDED_SIGNER_PK!;
const VERIFIER_PK = process.env.VERIFIER_PK!;
const AMOUNT_ENV = process.env.AMOUNT || "1.00";
let NETWORKS = process.env.NETWORKS || deployedNetworks.join(",");
const SINGLE_NETWORK: boolean = process.env.SINGLE_NETWORK === "single" ? true : false;
const networksToTest: string[] = NETWORKS.split(","); // ensure networks to test can be specified in workflow
const API_URLS: any = {
  prod: "https://us-central1-sedn-17b18.cloudfunctions.net",
  staging: "https://us-central1-staging-sedn.cloudfunctions.net",
  dev: "http://127.0.0.1:5001/staging-sedn/us-central1",
};
const API_URL = API_URLS[ENVIRONMENT];
ENVIRONMENT = ENVIRONMENT === "dev" ? "prod" : ENVIRONMENT; // ensure that dev is always reverting to staging

// some params & functions to facilitate metaTX testing / testnet
const testnet: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const auth = admin.auth();
const db = admin.firestore();

// /**********************************
// MULTICHAIN INTEGRATION TESTS
// *************************************/

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    let config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const signer = new ethers.Wallet(SIGNER_PK, provider);
    const verifier = new ethers.Wallet(VERIFIER_PK, provider);
    const recipient = new ethers.Wallet(RECIPIENT_PK, provider);
    const unfundedSigner = new ethers.Wallet(UNFUNDED_SIGNER_PK, provider);
    const relayerWebhook = config.relayerWebhooks[network];
    const forwarder = config.forwarder[network];
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdcOrigin = new ethers.Contract(
      config.usdc[network].contract,
      await getAbi(network, config.usdc[network].abi),
      signer,
    );
    const trusted = new FakeSigner(verifier, sedn.address);
    if (trusted.getAddress() !== config.verifier) {
      const error = new Error(`Using the wrong verifier: expected ${config.verifier} got ${trusted.getAddress()}`);
      console.error(error);
      throw error;
    }
    await sleep(1000);
    const decimals = await usdcOrigin.decimals();
    const decDivider = parseInt(10 ** decimals + "");
    const amount = parseInt(parseFloat(AMOUNT_ENV) * decDivider + "");
    return {
      sedn,
      usdcOrigin,
      signer,
      verifier,
      config,
      recipient,
      unfundedSigner,
      trusted,
      decDivider,
      amount,
      relayerWebhook,
      forwarder,
    };
  }
  describe(`Sedn testing with api`, function () {
    let sednVars: { [network: string]: any } = {};
    let deployed: any;
    const senderPhone = "+4917661597646"; // unfundedSigner
    const knownPhone = "+4917661597645"; // signer
    const claimerPhone = "+4917661597640"; // recipient
    let senderAuthToken;
    let knownAuthToken;
    let claimerAuthToken;
    let accountsToDelete;
    beforeEach(async function () {
      sednVars = [];
      for (const network of deployedNetworks) {
        deployed = await getSedn(network);
        sednVars[network] = deployed;
      }
      accountsToDelete = [
        senderPhone,
        knownPhone,
        claimerPhone,
        sednVars[networksToTest[0]].unfundedSigner.address,
        sednVars[networksToTest[0]].signer.address,
        sednVars[networksToTest[0]].recipient.address,
      ];
      await deleteAccountsForAnyUIDs(auth, db, accountsToDelete);
      senderAuthToken = await createUserAndGenerateIdToken(
        auth,
        db,
        senderPhone,
        sednVars[networksToTest[0]].unfundedSigner.address,
      );
      knownAuthToken = await createUserAndGenerateIdToken(
        auth,
        db,
        knownPhone,
        sednVars[networksToTest[0]].signer.address,
      );
    });
    it.only(`should be able to correctly sedn funds to an unknown user`, async function () {
      // partially randomized scenario creation
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("1", "mwei"),
          sedn: BigNumber.from("0"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0", "mwei"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.5", "mwei"),
          sedn: BigNumber.from("0"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0.7", "mwei"),
          sedn: BigNumber.from("0"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous usdc balances of unfundedSigner
      const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: claimerPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: claimerPhone,
      };
      // send signed transactions to API
      const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken))
        .id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      while (execution.status !== "executed" && execution.status !== "failed") {
        console.log("INFO: not executed retrying for ID", executionId);
        await sleep(10_000);
        execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        console.log(JSON.stringify(execution));
      }
      // establish usdc balances of unfundedSigner after execution
      const usdcAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // check correct execution of signer side
      const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork
        .add(usdcBeforeSednSignerSecondNetwork)
        .sub(usdcAfterSednSignerFirstNetwork.add(usdcAfterSednSignerSecondNetwork));
      expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // instantiate claimerUser & get solution
      const solution = execution.transactions[0].solution || "";
      claimerAuthToken = await createUserAndGenerateIdToken(
        auth,
        db,
        claimerPhone,
        sednVars[networksToTest[0]].recipient.address,
      );

      // build claim request and post to claim endpoint
      const claimRequest: IClaimRequest = {
        executionId: executionId,
        solution: solution,
        // in real life, this can be also the claimants phone number
      };
      const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

      // get signatures
      const claimTransactions: ITransaction[] = claimResponse.transactions;
      const signedClaimTransactions: ITransaction[] = [];
      for (const claimTransaction of claimTransactions) {
        const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
        claimTransaction.signedTx = claimSignedRequest;
        signedClaimTransactions.push(claimTransaction);
      }

      // build execute api request
      const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedClaimTransactions,
        environment: ENVIRONMENT as Environment,
        type: claimResponse.type,
        recipientIdOrAddress: claimerPhone,
      };

      // send signed transactions to API#
      const claimExecutionId = (
        await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
      ).id;
      console.log("INFO: executionIds", claimExecutionId);
      let claimExecution = await apiCall(
        API_URL,
        "executionStatus",
        { executionId: claimExecutionId },
        claimerAuthToken,
      );
      console.log("INFO: claimExecution", claimExecution);
      if (claimExecution.status !== "executed") {
        while (claimExecution.status !== "executed") {
          console.log("INFO: not executed, retrying", JSON.stringify(claimExecution));
          await sleep(10_000);
          claimExecution = await apiCall(
            API_URL,
            "executionStatus",
            { executionId: claimExecutionId },
            claimerAuthToken,
          );
        }
      }
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[firstNetwork].sedn,
        sednVars[firstNetwork].recipient,
        sednBeforeSednRecipientFirstNetwork,
      );
      if (!SINGLE_NETWORK) {
        console.log("second network triggered");
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].recipient,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );
      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly sedn funds to an known user`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("1", "mwei"),
          sedn: BigNumber.from("0"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0", "mwei"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.5", "mwei"),
          sedn: BigNumber.from("0"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0.7", "mwei"),
          sedn: BigNumber.from("0"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous usdc balances of unfundedSigner
      const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: knownPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      console.log("DEBUG: wireResponse.type:", wireResponse.type);

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: knownPhone,
      };
      // send signed transactions to API
      const executionId: IExecutionsResponse = (
        await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken)
      ).id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[firstNetwork].sedn,
        sednVars[firstNetwork].signer,
        sednBeforeSednRecipientFirstNetwork,
      );
      if (!SINGLE_NETWORK) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].signer,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
      // establish usdc balances of unfundedSigner after execution
      const usdcAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );
      // check correct execution of signer side
      const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork
        .add(usdcBeforeSednSignerSecondNetwork)
        .sub(usdcAfterSednSignerFirstNetwork.add(usdcAfterSednSignerSecondNetwork));
      expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );
      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly transfer funds to an unknown user`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("1", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("0.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("0.5", "mwei"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous sedn balances of unfundedSigner
      const sednBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: claimerPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: claimerPhone,
        memo: "sedn for transferUnknown",
      };
      // send signed transactions to API
      const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken))
        .id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }
      // establish usdc balances of unfundedSigner after execution
      const sednAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // check correct execution of signer side
      const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork
        .add(sednBeforeSednSignerSecondNetwork)
        .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
      expect(totalSednDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // instantiate claimerUser & get solution
      const solution = execution.transactions[0].solution || "";
      claimerAuthToken = await createUserAndGenerateIdToken(
        auth,
        db,
        claimerPhone,
        sednVars[networksToTest[0]].recipient.address,
      );

      // build claim request and post to claim endpoint
      const claimRequest: IClaimRequest = {
        executionId: executionId,
        solution: solution,
        // in real life, this can be also the claimants phone number
      };

      const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

      // get signatures
      const claimTransactions: ITransaction[] = claimResponse.transactions;
      const signedClaimTransactions: ITransaction[] = [];
      for (const claimTransaction of claimTransactions) {
        const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
        claimTransaction.signedTx = claimSignedRequest;
        signedClaimTransactions.push(claimTransaction);
      }

      // build execute api request
      const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedClaimTransactions,
        environment: ENVIRONMENT as Environment,
        type: claimResponse.type,
        recipientIdOrAddress: claimerPhone,
        memo: "claim for transfer",
      };
      // send signed transactions to API#
      const claimExecutionId = (
        await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
      ).id;
      console.log("INFO: executionIds", claimExecutionId);
      let claimExecution = await apiCall(
        API_URL,
        "executionStatus",
        { executionId: claimExecutionId },
        claimerAuthToken,
      );
      console.log("DEBUG: execution:", JSON.stringify(claimExecution));
      if (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
        while (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", claimExecutionId);
          await sleep(10_000);
          claimExecution = await apiCall(
            API_URL,
            "executionStatus",
            { executionId: claimExecutionId },
            claimerAuthToken,
          );
        }
      }
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[firstNetwork].sedn,
        sednVars[firstNetwork].recipient,
        sednBeforeSednRecipientFirstNetwork,
      );
      if (!SINGLE_NETWORK) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].recipient,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );
      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly transfer funds to an known user`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("1", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("0.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("0.5", "mwei"),
        };
      }

      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous sedn balances of unfundedSigner
      const sednBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: knownPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: knownPhone,
        memo: "send to known user",
      };
      // send signed transactions to API
      const executionId: IExecutionsResponse = (
        await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken)
      ).id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[firstNetwork].sedn,
        sednVars[firstNetwork].signer,
        sednBeforeSednRecipientFirstNetwork,
      );
      if (!SINGLE_NETWORK) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].signer,
          sednBeforeSednRecipientSecondNetwork,
        );
      }

      // establish sedn balances of unfundedSigner after execution
      const sednAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );
      // check correct execution of signer side
      const totalUsdcDifferenceSigner = sednBeforeSednSignerFirstNetwork
        .add(sednBeforeSednSignerSecondNetwork)
        .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
      expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );
      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly sedn and transfer funds to an unknown user`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.5", "mwei"),
          sedn: parseUnits("0.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.25", "mwei"),
          sedn: parseUnits("0.25", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0.25", "mwei"),
          sedn: parseUnits("0.25", "mwei"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous usdc balances of unfundedSigner
      const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of unfundedSigner
      const sednBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: claimerPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: claimerPhone,
        memo: "send for hybrid to unknown",
      };
      // send signed transactions to API
      const executionId = (await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken))
        .id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }

      // establish usdc balances of unfundedSigner after execution
      const usdcAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish sedn balances of unfundedSigner after execution
      const sednAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // check correct execution of signer side - usdc + sedn
      const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
        .add(
          usdcBeforeSednSignerSecondNetwork
            .add(sednBeforeSednSignerFirstNetwork)
            .add(sednBeforeSednSignerSecondNetwork),
        )
        .sub(
          usdcAfterSednSignerFirstNetwork
            .add(usdcAfterSednSignerSecondNetwork)
            .add(sednAfterSednSignerFirstNetwork)
            .add(sednAfterSednSignerSecondNetwork),
        );
      expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // instantiate claimerUser & get solution
      const solution = execution.transactions[0].solution || "";
      claimerAuthToken = await createUserAndGenerateIdToken(
        auth,
        db,
        claimerPhone,
        sednVars[networksToTest[0]].recipient.address,
      );

      // build claim request and post to claim endpoint
      const claimRequest: IClaimRequest = {
        executionId: executionId,
        solution: solution,
        // in real life, this can be also the claimants phone number
      };
      const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, claimerAuthToken);

      // get signatures
      const claimTransactions: ITransaction[] = claimResponse.transactions;
      const signedClaimTransactions: ITransaction[] = [];
      for (const claimTransaction of claimTransactions) {
        const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
        claimTransaction.signedTx = claimSignedRequest;
        signedClaimTransactions.push(claimTransaction);
      }

      // build execute api request
      const executeClaimTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedClaimTransactions,
        environment: ENVIRONMENT as Environment,
        type: claimResponse.type,
        recipientIdOrAddress: claimerPhone,
        memo: "claim for hybrid to unknown",
      };

      // send signed transactions to API#
      const claimExecutionId = (
        await apiCall(API_URL, "executeTransactions", executeClaimTransactionsRequest, claimerAuthToken)
      ).id;
      console.log("INFO: executionIds", claimExecutionId);
      let claimExecution = await apiCall(
        API_URL,
        "executionStatus",
        { executionId: claimExecutionId },
        claimerAuthToken,
      );
      console.log("DEBUG: execution:", JSON.stringify(claimExecution));
      if (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
        while (claimExecution.status !== "executed" && claimExecution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", claimExecutionId);
          await sleep(10_000);
          claimExecution = await apiCall(
            API_URL,
            "executionStatus",
            { executionId: claimExecutionId },
            claimerAuthToken,
          );
        }
      }

      for (const transaction of claimExecution.transactions) {
        const network = getChainFromId(transaction.chainId);
        console.log("firstNetwork", firstNetwork);
        console.log("secondNetwork", secondNetwork);
        console.log("network", network);
        if (network === firstNetwork) {
          await waitTillRecipientBalanceChanged(
            60_000,
            sednVars[firstNetwork].sedn,
            sednVars[firstNetwork].recipient,
            sednBeforeSednRecipientFirstNetwork,
          );
        }
        if (network === secondNetwork) {
          await waitTillRecipientBalanceChanged(
            60_000,
            sednVars[secondNetwork].sedn,
            sednVars[secondNetwork].recipient,
            sednBeforeSednRecipientSecondNetwork,
          );
        }
      }
      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
      );
      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly sedn and transfer funds to an known user`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.5", "mwei"),
          sedn: parseUnits("0.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.25", "mwei"),
          sedn: parseUnits("0.25", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: parseUnits("0.25", "mwei"),
          sedn: parseUnits("0.25", "mwei"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous usdc balances of unfundedSigner
      const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of unfundedSigner
      const sednBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );

      // build request for API
      const wireRequest: IWireRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        recipientId: knownPhone,
        amount: sednVars[firstNetwork].amount,
        testnet: testnet,
      };

      // send request to API
      const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = wireResponse.transactions;
      const signedTransactions: ITransaction[] = [];
      for (const transaction of transactions) {
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: wireResponse.type,
        recipientIdOrAddress: knownPhone,
        memo: "send for hybrid to known user",
      };
      // send signed transactions to API
      const executionId: IExecutionsResponse = (
        await apiCall(API_URL, "executeTransactions", executeTransactionsRequest)
      ).id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }
      for (const transaction of execution.transactions) {
        const network = getChainFromId(transaction.chainId);
        if (network === firstNetwork) {
          await waitTillRecipientBalanceChanged(
            60_000,
            sednVars[firstNetwork].sedn,
            sednVars[firstNetwork].signer,
            sednBeforeSednRecipientFirstNetwork,
          );
        }
        if (network === secondNetwork) {
          await waitTillRecipientBalanceChanged(
            60_000,
            sednVars[secondNetwork].sedn,
            sednVars[secondNetwork].signer,
            sednBeforeSednRecipientSecondNetwork,
          );
        }
      }

      // establish usdc balances of unfundedSigner after execution
      const usdcAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish sedn balances of unfundedSigner after execution
      const sednAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of recipient
      const sednAfterSednRecipientFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
      );
      const sednAfterSednRecipientSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
      );

      // check correct execution of signer side - usdc + sedn
      const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
        .add(
          usdcBeforeSednSignerSecondNetwork
            .add(sednBeforeSednSignerFirstNetwork)
            .add(sednBeforeSednSignerSecondNetwork),
        )
        .sub(
          usdcAfterSednSignerFirstNetwork
            .add(usdcAfterSednSignerSecondNetwork)
            .add(sednAfterSednSignerFirstNetwork)
            .add(sednAfterSednSignerSecondNetwork),
        );
      expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

      // check correct execution of recipient side
      const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
        .add(sednAfterSednRecipientSecondNetwork)
        .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
      expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
      //networks and represents the complete send amount
    });
    it(`should be able to correctly withdraw funds`, async function () {
      console.log("INFO: Creating funding scenario");
      const firstNetwork = networksToTest[0];
      const secondNetwork = networksToTest[1];
      const scenarioNetwork: INetworkScenarios = {};
      if (SINGLE_NETWORK) {
        // single network scenario
        scenarioNetwork[firstNetwork] = {
          usdc: parseUnits("0.0", "mwei"),
          sedn: parseUnits("1.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: BigNumber.from("0"),
        };
      } else {
        scenarioNetwork[firstNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("0.5", "mwei"),
        };
        scenarioNetwork[secondNetwork] = {
          usdc: BigNumber.from("0"),
          sedn: parseUnits("1", "mwei"),
        };
      }
      const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
      await instantiateFundingScenario(completeFundingScenario, sednVars);
      console.log("INFO: Done funding");

      // establish previous usdc balances of unfundedSigner
      const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );

      // establish previous sedn balances of unfundedSigner
      const sednBeforeSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednBeforeSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );

      // build request for withdraw API
      const wireRequest: IWithdrawRequest = {
        senderAddress: sednVars[firstNetwork].unfundedSigner.address,
        destinationAddress: sednVars[firstNetwork].unfundedSigner.address,
        destinationChainId: parseInt(getChainId(firstNetwork)) as ChainId,
        amount: sednVars[firstNetwork].amount,
        useStargate: false,
        environment: ENVIRONMENT as Environment,
        testnet: testnet,
      };

      // send request to API
      const withdrawResponse: ITransaction[] = await apiCall(API_URL, "withdraw", wireRequest, senderAuthToken);

      // get approve and signatures
      const transactions: ITransaction[] = withdrawResponse;
      const signedTransactions: ITransaction[] = [];
      for (let transaction of transactions) {
        if (testnet === true && transaction.type === "bridgeWithdraw") {
          transaction.chainId = parseInt(getChainId(secondNetwork)); // since we specify first network as home chain
          // we can safely assume that the fake chainID (for socket purposes) is the second network
          console.log("INFO: chain ID corrected to", transaction.chainId);
        }
        const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
        transaction.signedTx = signedRequest;
        signedTransactions.push(transaction);
      }

      // build api request
      const executeTransactionsRequest: IExecuteTransactionsRequest = {
        transactions: signedTransactions,
        environment: ENVIRONMENT as Environment,
        type: "withdraw" as TransactionType,
        recipientIdOrAddress: senderPhone,
        memo: "withdraw test",
      };
      // send signed transactions to API
      const executionId: IExecutionsResponse = (
        await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, senderAuthToken)
      ).id;
      console.log("INFO: executionIds", executionId);
      let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
      console.log("DEBUG: execution:", JSON.stringify(execution));
      if (execution.status !== "executed" && execution.status !== "failed") {
        while (execution.status !== "executed" && execution.status !== "failed") {
          console.log("INFO: not executed retrying for ID", executionId);
          await sleep(10_000);
          execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, senderAuthToken);
        }
      }
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[firstNetwork].sedn,
        sednVars[firstNetwork].recipient,
        sednBeforeSednSignerFirstNetwork,
      );
      if (!SINGLE_NETWORK) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].recipient,
          sednBeforeSednSignerSecondNetwork,
        );
      }

      // establish usdc balances of unfundedSigner after execution
      const usdcAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
      );
      const udscAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
      );
      // check correct execution of signer side
      const totalUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork
        .add(udscAfterSednSignerSecondNetwork)
        .sub(usdcBeforeSednSignerFirstNetwork.add(usdcBeforeSednSignerSecondNetwork));
      const firstNetworkUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork.sub(usdcBeforeSednSignerFirstNetwork);
      if (testnet === true) {
        expect(totalUsdcDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all networks and represents the complete send amount
      } else {
        expect(totalUsdcDifferenceSigner).to.be.gt(firstNetworkUsdcDifferenceSigner.toNumber()); // should be more than the non-bridged amount
      }

      // establish previous sedn balances of signer
      const sednAfterSednSignerFirstNetwork = BigNumber.from(
        await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
      );
      const sednAfterSednSignerSecondNetwork = BigNumber.from(
        await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
      );
      // check correct execution of signer side
      const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork
        .add(sednBeforeSednSignerSecondNetwork)
        .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
      expect(totalSednDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all
      //networks and represents the complete send amount
    });
  });
});
