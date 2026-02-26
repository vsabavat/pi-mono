declare module "dotenv" {
	export interface DotenvConfigOptions {
		path?: string;
		override?: boolean;
	}

	export function config(options?: DotenvConfigOptions): { parsed?: Record<string, string>; error?: Error };
}
