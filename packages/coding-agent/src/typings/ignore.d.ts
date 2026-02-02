declare module "ignore" {
	export interface Ignore {
		add(patterns: string | string[]): Ignore;
		ignores(path: string): boolean;
	}

	export default function ignore(): Ignore;
}
