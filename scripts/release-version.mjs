import fs from "node:fs";
export function releaseVersion(root = process.cwd()) {
  const { version } = JSON.parse(
    fs.readFileSync(`${root}/package.json`, "utf8"),
  );
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)
  )
    throw new Error("Invalid application version");
  return version;
}
export function versionChecks(expected, configuration, imageTag, observations) {
  return [
    { id: "configuration-version", pass: configuration === expected },
    { id: "configured-image-tag", pass: imageTag === expected },
    ...Object.entries(observations).map(([id, actual]) => ({
      id,
      pass: actual === expected,
    })),
  ];
}
