declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
  ) => void;
};

declare module "https://esm.sh/@supabase/supabase-js@2.95.3" {
  export const createClient: (...args: any[]) => any;
}
