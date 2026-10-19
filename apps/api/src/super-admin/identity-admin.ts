import {
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { env } from "../common/env";
@Injectable()
export class IdentityAdmin {
  private client = env.SUPABASE_SECRET_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  get available() {
    return this.client !== null;
  }
  private auth() {
    if (!this.client)
      throw new ServiceUnavailableException(
        "Owner login creation and password reset require the server-only Supabase secret key.",
      );
    return this.client.auth.admin;
  }
  async create(email: string, password: string, displayName: string) {
    const { data, error } = await this.auth().createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user)
      throw new BadRequestException(
        "Could not create login. Check the email and password policy, or link an existing account.",
      );
    return { id: data.user.id, email: data.user.email ?? email };
  }
  async reset(userId: string, password: string) {
    const { error } = await this.auth().updateUserById(userId, { password });
    if (error)
      throw new BadRequestException(
        "Password was not changed by the identity provider.",
      );
  }
  async removeNewAccount(userId: string) {
    const { error } = await this.auth().deleteUser(userId);
    if (error) throw new Error("New owner account cleanup failed");
  }
}
