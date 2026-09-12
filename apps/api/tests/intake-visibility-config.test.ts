import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import express from "express";
import request from "supertest";
import { getIntakeVisibilityConfig } from "../src/intake-visibility-config.js";
import { createIntakeExceptionsRouter } from "../src/intake-exceptions-router.js";
import { parseTemplate, evaluateTemplate } from "../../../scripts/intake-storage-template.mjs";
import { captureParameters, captureVariables } from "../../../scripts/tests/fixtures/intake-capture-config.mjs";
import { recoveryParameters } from "../../../scripts/tests/fixtures/intake-recovery-config.mjs";
import { visibilityParameters, visibilityValidation } from "../../../scripts/tests/fixtures/intake-visibility-config.mjs";
const template = parseTemplate(readFileSync(new URL("../../../infra/aws/api-cloudformation.yaml", import.meta.url), "utf8"));
const emitted = (params: Record<string,string>) => Object.fromEntries(Object.entries(captureVariables(evaluateTemplate(template, params, visibilityValidation))).map(([key,value])=>[key,String(value)]));
const environment = emitted(visibilityParameters);

test("all emitted visibility modes parse; disabled visibility ignores invalid configuration", () => {
  for (const capture of ["false","true"]) for (const recovery of ["false","true"]) for (const visibility of ["false","true"]) {
    assert.deepEqual(getIntakeVisibilityConfig(emitted({ ...captureParameters, ...recoveryParameters, ...visibilityParameters, IntakeAssuranceCaptureEnabled: capture, IntakeAssuranceRecoveryEnabled: recovery, IntakeAssuranceVisibilityEnabled: visibility })), { enabled: visibility === "true", customer_ids: visibility === "true" ? ["synthetic"] : [] });
  }
  for (const flag of [undefined,"false","TRUE","1"," true "]) assert.deepEqual(getIntakeVisibilityConfig({ PATHFINDER_RUNTIME:"lambda",PATHFINDER_ENABLE_INTAKE_EXCEPTIONS:flag,PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS:"bad,list" }),{enabled:false,customer_ids:[]});
});

test("runtime independently rejects missing auth, unsafe or multiple customers and ephemeral Lambda storage", () => {
  for (const value of [undefined,"false","TRUE"]) assert.throws(()=>getIntakeVisibilityConfig({...environment,PATHFINDER_REQUIRE_AUTH:value}),/authentication/);
  for (const value of [undefined,""," ","one,two","id\n","a".repeat(257)]) assert.throws(()=>getIntakeVisibilityConfig({...environment,PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS:value}),/customer ID/);
  for (const marker of [{PATHFINDER_RUNTIME:"lambda"},{PATHFINDER_RUNTIME:undefined,AWS_LAMBDA_FUNCTION_NAME:"synthetic"}]) {
    for(const driver of [undefined,"local","bad"]) assert.throws(()=>getIntakeVisibilityConfig({...environment,...marker,PATHFINDER_STORAGE_DRIVER:driver}),/DynamoDB driver/);
    for(const table of [undefined,""," table\n"]) assert.throws(()=>getIntakeVisibilityConfig({...environment,...marker,PATHFINDER_INTAKE_ATTEMPTS_TABLE:table}),/table binding/);
  }
});

test("configured router isolates the customer before reads and exposes no write route", async () => {
  let reads=0;
  const app=express().use(createIntakeExceptionsRouter({...getIntakeVisibilityConfig(environment),list:async(customer)=>{assert.equal(customer,"synthetic");reads++;return {attempts:[],next_cursor:null};},listDeliveries:async(customer)=>{assert.equal(customer,"synthetic");reads++;return {receipts:[],next_cursor:null};}}));
  for(const route of ["intake-exceptions","intake-deliveries"]) {
    await request(app).get(`/customers/other/${route}?customer_id=synthetic`).expect(423);
    assert.equal(reads,0);
    for(const method of ["post","put","patch","delete"] as const) await request(app)[method](`/customers/synthetic/${route}`).send({customer_id:"synthetic"}).expect(404);
  }
  await request(app).get('/customers/synthetic/intake-exceptions').expect(200).expect("Cache-Control","no-store");
  assert.equal(reads,1);
});

test("actual API requires authentication before visibility reads and does not contact providers", () => {
  const script = `
    const assert=(await import('node:assert/strict')).default;
    let calls=0; globalThis.fetch=async()=>{calls++;throw new Error('Unexpected provider call');};
    const {DynamoDBClient}=await import('@aws-sdk/client-dynamodb');
    DynamoDBClient.prototype.send=async()=>{calls++;throw new Error('Unexpected ledger call');};
    const {app}=await import(${JSON.stringify(new URL('../src/server.ts',import.meta.url).href)});
    const request=(await import('supertest')).default;
    for(const route of ['intake-exceptions','intake-deliveries']) await request(app).get('/api/customers/synthetic/'+route).expect(401);
    assert.equal(calls,0);
  `;
  const result=spawnSync(process.execPath,["--import","tsx/esm","--input-type=module","-e",script],{encoding:"utf8",env:{...process.env,...environment}});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
