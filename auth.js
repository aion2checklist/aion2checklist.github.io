// OAuth do Discord via Supabase. Nenhum segredo fica neste arquivo.
export function createAuthController(client){
  return {
    async signInDiscord(redirectTo){
      if(!client) return {data:null,error:new Error("Supabase indisponível")};
      return client.auth.signInWithOAuth({
        provider:"discord",
        options:{redirectTo}
      });
    },
    async signOut(){
      if(!client) return {error:null};
      return client.auth.signOut();
    },
    async getSession(){
      if(!client) return {data:{session:null},error:null};
      return client.auth.getSession();
    },
    onAuthStateChange(callback){
      if(!client) return {data:{subscription:null}};
      return client.auth.onAuthStateChange(callback);
    }
  };
}

export function discordDisplayName(user){
  const metadata=user?.user_metadata||{};
  return metadata.full_name||metadata.name||metadata.user_name||metadata.preferred_username||metadata.email||"Daeva";
}

export function discordAvatar(user){
  const metadata=user?.user_metadata||{};
  return metadata.avatar_url||metadata.picture||"";
}
