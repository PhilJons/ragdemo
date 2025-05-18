import { AuthOptions, Account, Profile, Session } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { JWT } from "next-auth/jwt";

// This is the central configuration for NextAuth.js
// It's used in the [...nextauth]/route.ts and can be used with getServerSession in API routes
export const authOptions: AuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: "openid profile email User.Read" } },
      profile(profile: any) {
        return {
          id: profile.sub, 
          name: profile.name,
          email: profile.email,
          image: null, 
          oid: profile.oid,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }: { token: JWT; account: Account | null; profile?: Profile & { oid?: string } }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (profile) {
        token.oid = profile.oid;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        // @ts-ignore 
        session.user.oid = token.oid as string;
      }
      // @ts-ignore 
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  // pages: {
  //   signIn: '/auth/signin',
  // },
}; 