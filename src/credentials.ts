export interface BasicCredentials {
  readonly username: string;
  readonly password: string;
}

export interface CredentialProvider {
  getCredentials(): BasicCredentials;
}

export function createFileCredentialProvider(credentials: BasicCredentials): CredentialProvider {
  const username = credentials.username;
  const password = credentials.password;

  return {
    getCredentials: () => ({ username, password }),
  };
}
