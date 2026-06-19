'use strict';

/**
 * Minimal Octopus "Kraken" GraphQL client.
 *
 * The REST API does not expose the account balance, so we use GraphQL for that:
 *  1. Exchange the REST API key for a short-lived Kraken JWT (obtainKrakenToken).
 *  2. Query the account balance (returned in pence).
 *
 * The token is cached and transparently refreshed when it expires or a request
 * is rejected as unauthenticated.
 */

const GRAPHQL_URL = 'https://api.octopus.energy/v1/graphql/';

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { errorCode?: string } }>;
}

export class KrakenClient {

  private readonly apiKey: string;

  private readonly url: string;

  private token: string | null = null;

  private tokenExpiry = 0;

  constructor(apiKey: string, url: string = GRAPHQL_URL) {
    if (!apiKey) throw new Error('An Octopus API key is required.');
    this.apiKey = apiKey;
    this.url = url;
  }

  private async query<T>(query: string, variables: Record<string, unknown>, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = await this.getToken();
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json() as GraphQLResponse<T>;
    if (json.errors?.length) {
      const unauthenticated = json.errors.some(
        (e) => e.extensions?.errorCode === 'KT-CT-1124' || /authenticat/i.test(e.message),
      );
      if (auth && unauthenticated) {
        // Token likely expired — refresh once and retry.
        this.token = null;
        headers.Authorization = await this.getToken();
        const retry = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables }),
        });
        const retryJson = await retry.json() as GraphQLResponse<T>;
        if (retryJson.errors?.length) throw new Error(retryJson.errors[0].message);
        return retryJson.data as T;
      }
      throw new Error(json.errors[0].message);
    }
    return json.data as T;
  }

  /** Obtain (and cache) a Kraken JWT from the REST API key. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    const mutation = `
      mutation ObtainKrakenToken($apiKey: String!) {
        obtainKrakenToken(input: { APIKey: $apiKey }) {
          token
        }
      }`;
    const data = await this.query<{ obtainKrakenToken: { token: string } }>(
      mutation,
      { apiKey: this.apiKey },
      false,
    );
    const token = data?.obtainKrakenToken?.token;
    if (!token) throw new Error('Could not obtain a Kraken token — check your API key.');
    this.token = token;
    // Kraken tokens last ~1 hour; refresh a little early to be safe.
    this.tokenExpiry = Date.now() + 50 * 60 * 1000;
    return token;
  }

  /** Account balance in pounds (the API returns pence). */
  async getBalance(accountNumber: string): Promise<number> {
    const query = `
      query AccountBalance($accountNumber: String!) {
        account(accountNumber: $accountNumber) {
          balance
        }
      }`;
    const data = await this.query<{ account: { balance: number } }>(query, { accountNumber });
    const pence = Number(data?.account?.balance ?? 0);
    return pence / 100;
  }
}
