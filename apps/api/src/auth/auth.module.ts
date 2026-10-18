import {
  CanActivate,
  ExecutionContext,
  Global,
  Inject,
  Injectable,
  Module,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { FastifyRequest } from "fastify";
import { env } from "../common/env";
import { Identity } from "../database/database.module";
export type AuthRequest = FastifyRequest & { identity: Identity };
@Injectable()
export class TokenVerifier {
  private readonly auth = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth;
  async verify(token: string): Promise<Identity> {
    const { data, error } = await this.auth.getUser(token);
    if (error || !data.user)
      throw new UnauthorizedException("Invalid or expired session");
    return { id: data.user.id };
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? "");
    if (!match) throw new UnauthorizedException("Bearer session required");
    request.identity = await this.verifier.verify(match[1]);
    return true;
  }
}
@Global()
@Module({
  providers: [TokenVerifier, AuthGuard],
  exports: [TokenVerifier, AuthGuard],
})
export class AuthModule {}

export { UnauthorizedException } from "@nestjs/common";
