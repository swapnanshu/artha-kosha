import "server-only";
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import type { Account, Category, Txn } from "@/lib/types";

/**
 * The Admin SDK does not run converters on read (it returns plain objects with
 * Timestamp fields), but declaring them here keeps writes shaped correctly and
 * gives M2 a single place to add validation.
 */
export const txnConverter: FirestoreDataConverter<Txn> = {
  toFirestore(txn: Txn): DocumentData {
    return txn;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Txn {
    return snapshot.data() as Txn;
  },
};

export const accountConverter: FirestoreDataConverter<Account> = {
  toFirestore(account: Account): DocumentData {
    return account;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Account {
    return snapshot.data() as Account;
  },
};

export const categoryConverter: FirestoreDataConverter<Category> = {
  toFirestore(category: Category): DocumentData {
    return category;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Category {
    return snapshot.data() as Category;
  },
};
