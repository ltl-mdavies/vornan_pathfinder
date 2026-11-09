import {readFileSync} from 'node:fs';import {validateOffline,operationalEntry} from './contract.mjs';
try{
 const [mode,inputPath,archivePath,...extra]=process.argv.slice(2);
 if(mode!=='--offline-plan'||!inputPath||extra.length)operationalEntry();
 const raw=readFileSync(inputPath);if(raw.length>16384)throw Error('Input too large');
 const input=JSON.parse(raw);if(input.mode==='recovery'&&archivePath)operationalEntry();
 const result=validateOffline(input,archivePath?readFileSync(archivePath):undefined);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch{process.stderr.write('HOLD: invalid offline contract or unsupported operational request. No actions performed.\n');process.exitCode=78;}
