import axios from "axios";
import * as admin from "firebase-admin";
import { Auth } from "firebase-admin/lib/auth/auth";
import { UserRecord } from "firebase-admin/lib/auth/user-record";
import { IAccount, ICreateAccount, IExecution } from "sedn-interfaces";
import { v4 as uuid } from "uuid";

const COLLECTION_NAME = "accounts";

export const getIdToken = async (user: UserRecord) => {
  const gCloudProject = process.env.GCLOUD_PROJECT;
  let firebaseKey: string;
  if (gCloudProject === "sedn-staging") {
    firebaseKey = process.env.FIREBASE_KEY_sedn_staging!;
  } else {
    firebaseKey = process.env.FIREBASE_KEY_sedn_production!;
  }

  let url: string;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${firebaseKey}`;
  } else {
    url = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${firebaseKey}`;
  }
  const customToken = await admin.auth().createCustomToken(user.uid);
  const idTokenResponse = await axios.post(url, {
    token: customToken,
    returnSecureToken: true,
  });
  return idTokenResponse.data.idToken;
};

export const createUser = async (auth: Auth, db: admin.firestore.Firestore, phoneNumber?: string, address?: string) => {
  // Use case
  // user with only an address
  // user with only a phone number
  // user with an address and a phone number
  let phoneUser: UserRecord;
  let addressUser: UserRecord;
  let masterAccountRef: any;
  let masterAccount: IAccount;
  if (phoneNumber) {
    try {
      phoneUser = await auth.getUserByPhoneNumber(phoneNumber);
    } catch (error) {
      // @ts-ignore
      if (!error.code || error.code != "auth/user-not-found") {
        throw error;
      }
    }
    // @ts-ignore
    if (!phoneUser) {
      phoneUser = await auth.createUser({
        phoneNumber: phoneNumber,
      });
    }

    const hasMasterAccountUnqualified = await getAccountConnectionRecordsForAnyUID(db, phoneUser.uid);
    let hasMasterAccount: IAccount | null = null;
    if (Array.isArray(hasMasterAccountUnqualified)) {
      hasMasterAccount = hasMasterAccountUnqualified[0];
    }
    if (!hasMasterAccount) {
      const res = await createAccountInDatabase(db, {
        phoneUID: phoneUser.uid,
      });
      masterAccountRef = res.ref;
      masterAccount = res.account;
    } else {
      masterAccountRef = db.collection(COLLECTION_NAME).doc(hasMasterAccount.master);
      masterAccount = hasMasterAccount;
    }
  }

  if (address) {
    try {
      addressUser = await auth.getUser(address);
    } catch (error) {
      // @ts-ignore
      if (!error.code || error.code != "auth/user-not-found") {
        throw error;
      }
    }
    // @ts-ignore
    if (!addressUser) {
      addressUser = await auth.createUser({
        uid: address,
      });
    }
  }

  // @ts-ignore
  if (phoneUser && addressUser) {
    await masterAccountRef.update({
      phoneUID: phoneUser.uid,
      primaryWalletUID: addressUser.uid,
    });
  }
  // @ts-ignore
  return { phoneUser, addressUser };
};

// TODO: this is only used by tests - remove
export const createUserAndGenerateIdToken = async (
  auth: Auth,
  db: admin.firestore.Firestore,
  phoneNumber: string,
  address: string,
) => {
  const users = await createUser(auth, db, phoneNumber, address);
  const idToken = await getIdToken(users.addressUser || users.phoneUser);
  return idToken;
};

const getAccountConnectionRecordsForAnyUID = async (
  db: admin.firestore.Firestore,
  uid: string,
): Promise<IAccount[] | IAccount | null> => {
  const doc = await db.collection(COLLECTION_NAME).doc(uid).get();
  if (doc.exists) {
    const data = doc.data() as IAccount;
    return data;
  }

  const walletAccountSnapshot = await db.collection(COLLECTION_NAME).where("primaryWalletUID", "==", uid).get();

  let accounts: IAccount[] = [];
  if (!walletAccountSnapshot.empty) {
    for (const account of walletAccountSnapshot.docs) {
      accounts.push(account.data() as IAccount);
    }
    return accounts;
  }

  const phoneAccountSnapshot = await db.collection(COLLECTION_NAME).where("phoneUID", "==", uid).get();

  if (!phoneAccountSnapshot.empty) {
    for (const account of phoneAccountSnapshot.docs) {
      accounts.push(account.data() as IAccount);
    }
    return accounts;
  }

  return null;
};

const createAccountInDatabase = async (db: admin.firestore.Firestore, { phoneUID, walletUID }: ICreateAccount) => {
  const uid = uuid();
  let account = {
    master: uid,
  } as IAccount;

  if (phoneUID) {
    account.phoneUID = phoneUID;
  }
  if (walletUID) {
    account.primaryWalletUID = walletUID;
  }

  await db.collection(COLLECTION_NAME).doc(uid).set(account);
  const ref = db.collection(COLLECTION_NAME).doc(uid);
  return {
    ref,
    account,
  };
};

const deleteAccountConnectionRecordsForAnyUID = async (db: admin.firestore.Firestore, uid: string): Promise<void> => {
  const accountData = await getAccountConnectionRecordsForAnyUID(db, uid);
  if (Array.isArray(accountData)) {
    for (const account of accountData) {
      await db.collection(COLLECTION_NAME).doc(account.master).delete();
    }
    return;
  }
  if (accountData) {
    await db.collection(COLLECTION_NAME).doc(accountData.master).delete();
  }
  return;
};

export const deleteAccountsForAnyUIDs = async (
  auth: Auth,
  db: admin.firestore.Firestore,
  UIDs: string[],
): Promise<void> => {
  for (const uid of UIDs) {
    // ensure there is no account record for this uid
    await deleteAccountConnectionRecordsForAnyUID(db, uid); // this shouldn't throw an error if there is no account record
    // delete auth record
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      //   console.log("INFO: No UID found, trying to delete as a phone UID");
      try {
        const userRecord = await auth.getUserByPhoneNumber(uid); // see if its a phone number UID
        await auth.deleteUser(userRecord.uid);
      } catch (error) {
        // console.log("INFO; No wallet UID found, skipping");
        continue;
      }
    }
  }
  return;
};

const getExecutionRecordsForAnyPhone = async (db: admin.firestore.Firestore, phone: string) => {
  const results: IExecution[] = [];
  const recipientField: string = "recipient";
  await db
    .collection("execution")
    .where(recipientField, "==", phone)
    .get()
    .then((querySnapshot: any) => {
      querySnapshot.forEach((doc: any) => {
        results.push(doc.data() as IExecution);
      });
    });
  return results;
};

export const deleteExecutionRecordsForAnyPhone = async (db: admin.firestore.Firestore, phone: string) => {
  const executions = await getExecutionRecordsForAnyPhone(db, phone);
  if (!executions) {
    return;
  }
  for (const execution of executions) {
    await db.collection("execution").doc(execution.id).delete();
  }
};
