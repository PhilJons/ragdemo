import { AuthOptions, Account, Profile, Session } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { JWT } from "next-auth/jwt";
import prisma from "@/lib/prisma"; // Import Prisma client for database operations

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
        // Ensure oid is consistently available for jwt callback
        return {
          id: profile.sub, // Use sub as the standard id from provider for NextAuth
          name: profile.name,
          email: profile.email,
          image: null, 
          oid: profile.oid, // This is the Azure AD Object ID we need
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }: { token: JWT; account: Account | null; profile?: Profile & { oid?: string, email?: string, name?: string } }) {
      // Persist the OAuth access_token and Azure AD OID to the token right after signin
      if (account) { // account is present on successful sign-in
        token.accessToken = account.access_token;
      }
      if (profile && profile.oid) { // profile is present on first sign-in with provider
        token.oid = profile.oid; // Ensure OID is on the token

        // Check if user exists, if not, create them (user provisioning)
        let user = await prisma.user.findUnique({
          where: { oid: profile.oid },
        });

        if (!user) {
          console.log(`User with OID ${profile.oid} not found. Creating new user...`);
          try {
            user = await prisma.user.create({
              data: {
                oid: profile.oid,
                email: profile.email,       // Make sure email is in scope and profile type
                displayName: profile.name,  // Make sure name is in scope and profile type
                // Add any other default fields for User model if necessary
              },
            });
            console.log(`New user created with ID: ${user.id} and OID: ${user.oid}`);
          } catch (createError) {
            console.error("Error creating new user in JWT callback:", createError);
            // Optionally, you might want to prevent session creation if user provisioning fails
            // For now, just log and proceed without the DB user link if it fails
          }
        } else {
          console.log(`User with OID ${profile.oid} found. ID: ${user.id}`);
        }
        // You could also add the internal DB user.id to the token if needed elsewhere:
        // if (user) { token.dbUserId = user.id; }
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      // Send properties to the client, like an access_token and user OID from the token.
      if (session.user) {
        // @ts-ignore - Augmenting session user type
        session.user.oid = token.oid as string;
      }
      // @ts-ignore - Augmenting session type
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  // pages: {
  //   signIn: '/auth/signin',
  // },
}; 