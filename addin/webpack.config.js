/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const devCerts = (() => {
  try {
    return require("office-addin-dev-certs");
  } catch {
    return null;
  }
})();

module.exports = async (env, options) => {
  const isDev = options.mode === "development";

  const httpsConfig = isDev && devCerts
    ? await devCerts.getHttpsServerOptions()
    : false;

  return {
    entry: {
      taskpane: "./src/taskpane/index.tsx",
      functions: "./src/functions/functions.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: "ts-loader",
            options: {
              compilerOptions: { noEmit: false },
            },
          },
          exclude: /node_modules/,
        },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        filename: "functions.html",
        template: "./src/functions/functions.html",
        chunks: ["functions"],
      }),
      {
        apply(compiler) {
          compiler.hooks.thisCompilation.tap("CopyFunctionsMetadata", (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: "CopyFunctionsMetadata",
                stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
              },
              () => {
                const source = fs.readFileSync(path.resolve(__dirname, "src/functions/functions.json"), "utf8");
                compilation.emitAsset("functions.json", new compiler.webpack.sources.RawSource(source));
              }
            );
          });
        },
      },
    ],
    devServer: {
      port: 3000,
      https: httpsConfig,
      headers: { "Access-Control-Allow-Origin": "*" },
    },
    devtool: isDev ? "source-map" : false,
  };
};
