import { parseDocument } from "yaml";

// Offline template evaluation for contract checks, not a CloudFormation deployment engine.
export function parseTemplate(source) {
  const scalar = ["Ref", "Condition", "GetAtt", "Sub"];
  const sequence = ["Equals", "And", "Or", "Not", "If", "Join", "Split", "Sub"];
  const document = parseDocument(source, { customTags: [
    ...scalar.map((name) => ({ tag: `!${name}`, resolve: (value) => ({ [name]: value }) })),
    ...sequence.map((name) => ({ tag: `!${name}`, collection: "seq", resolve: (value) => ({ [name]: value.toJSON() }) }))
  ] });
  if (document.errors.length || document.warnings.length) throw new Error("Invalid or unsupported template YAML");
  return document.toJS();
}

const omitted = Symbol("AWS::NoValue");
export function evaluateTemplate(template, overrides = {}) {
  const parameters = Object.fromEntries(Object.entries(template.Parameters).map(([key, value]) =>
    [key, value.Default ?? `fixture-${key}`]));
  Object.assign(parameters, { "AWS::Region": "us-east-1", "AWS::AccountId": "123456789012", "AWS::Partition": "aws" }, overrides);
  const condition = (name) => evaluate(template.Conditions[name]);
  const ref = (name) => {
    if (name === "AWS::NoValue") return omitted;
    if (name in parameters) return parameters[name];
    const resource = template.Resources[name];
    if (!resource) throw new Error(`Unknown reference: ${name}`);
    if (resource.Condition && !condition(resource.Condition)) throw new Error(`Reference to disabled resource: ${name}`);
    return resource.Properties.TableName ? evaluate(resource.Properties.TableName) : `fixture-${name}`;
  };
  const evaluate = (value) => {
    if (Array.isArray(value)) return value.map(evaluate).filter((item) => item !== omitted);
    if (!value || typeof value !== "object") return value;
    if (Object.keys(value).length === 1) {
      const [key, operand] = Object.entries(value)[0];
      if (key === "Ref") return ref(operand);
      if (key === "Condition") return condition(operand);
      if (key === "Equals") return evaluate(operand[0]) === evaluate(operand[1]);
      if (key === "And") return operand.every(evaluate);
      if (key === "Or") return operand.some(evaluate);
      if (key === "Not") return !evaluate(operand[0]);
      if (key === "If") return evaluate(operand[condition(operand[0]) ? 1 : 2]);
      if (key === "GetAtt") {
        const [name, attribute] = operand.split(".");
        const target = ref(name);
        return template.Resources[name].Type === "AWS::DynamoDB::Table" && attribute === "Arn"
          ? `arn:aws:dynamodb:${parameters["AWS::Region"]}:${parameters["AWS::AccountId"]}:table/${target}`
          : `fixture-${name}-${attribute}`;
      }
      if (key === "Sub") {
        const [pattern, bindings] = typeof operand === "string" ? [operand, {}] : operand;
        return pattern.replace(/\$\{([^}]+)\}/g, (_, name) => String(name in bindings ? evaluate(bindings[name]) : name.includes(".") ? evaluate({ GetAtt: name }) : ref(name)));
      }
      if (key === "Join") return evaluate(operand[1]).join(operand[0]);
      if (key === "Split") return evaluate(operand[1]).split(operand[0]);
    }
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const resolved = evaluate(item);
      return resolved === omitted ? [] : [[key, resolved]];
    }));
  };
  const section = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) =>
    !value.Condition || condition(value.Condition)).map(([key, value]) => [key, evaluate(value)]));
  return { Resources: section(template.Resources), Outputs: section(template.Outputs) };
}

export function environmentBytes(variables) {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new Error("Expected environment variable map");
  return Object.entries(variables).reduce((total, [key, value]) => {
    if (typeof value !== "string") throw new Error("Environment values must be strings");
    return total + Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
  }, 0);
}
