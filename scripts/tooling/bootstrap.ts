const command = "./node_modules/.bin/lefthook install";

process.stdout.write("After a successful frozen install, run this command manually in your clone:\n");
process.stdout.write(`${command}\n`);
process.stdout.write(
  "Verify the generated hook, then use './node_modules/.bin/lefthook uninstall' before reinstalling when required.\n",
);
