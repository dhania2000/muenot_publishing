import {describe,it,expect} from "vitest"
import {validateEquation,sanitizePresentationMathml} from "@/lib/alt-text/math-validation"
describe("real bounded KaTeX parser and presentation conversion",()=>{
 for(const [name,source,tag] of [
  ["nested fractions",String.raw`\frac{1}{1+\frac{1}{x}}`,"mfrac"],
  ["roots",String.raw`\sqrt[3]{x}`,"mroot"],
  ["matrix",String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`,"mtable"],
  ["integral",String.raw`\int_0^1 x^2\,dx`,"msubsup"],
  ["sum",String.raw`\sum_{i=1}^n i`,"munderover"],
  ["aligned",String.raw`\begin{aligned}x+y&=3\\x-y&=1\end{aligned}`,"mtable"],
  ["Greek and scripts",String.raw`\alpha_i^2+\beta=\gamma`,"msubsup"],
  ["unit text",String.raw`v=2\,\text{m/s}`,"mtext"],
  ["Unicode text",String.raw`\text{Equation समीकरण}=1`,"mtext"],
 ] as const)it(`parses and converts ${name} without approving its source`,()=>{
  const result=validateEquation(source,8)
  expect(result.syntaxStatus,JSON.stringify(result.issues)).toBe("valid");expect(result.mathmlStatus,JSON.stringify(result.issues)).toBe("generated")
  expect(result.presentationMathml).toContain(`<${tag}`);expect(result.humanVerified).toBe(false);expect(result.sourceMatchVerified).toBe(false);expect(result.originalCandidate).toBe(source)
 })
 it("explicitly removes only matching outer display delimiters and preserves the original candidate",()=>{
  const source=String.raw`\[\frac{a}{b}\]`,result=validateEquation(source,1)
  expect(result.originalCandidate).toBe(source);expect(result.selectedLatex).toBe(source);expect(result.parserInput).toBe(String.raw`\frac{a}{b}`);expect(result.delimiterHandling).toBe("outer_math_delimiters");expect(result.syntaxStatus).toBe("valid")
 })
 for(const source of [String.raw`\frac{a}{`,String.raw`x^^2`,String.raw`x__1`,String.raw`\begin{matrix}1&2\\3\end{matrix}`,String.raw`\begin{matrix}1&2`,String.raw`\frac{}{2}`,"x+"])
 it(`reports malformed syntax: ${source}`,()=>{const r=validateEquation(source,1);expect(r.syntaxStatus).not.toBe("valid");expect(r.presentationMathml).toBeNull();expect(r.issues.some((i)=>i.severity==="error")).toBe(true)})
 for(const source of [String.raw`\href{https://evil.invalid}{x}`,String.raw`\includegraphics{x}`,String.raw`\htmlStyle{color:red}{x}`,String.raw`\def\a{\a}\a`,String.raw`\newcommand{\a}{x}`,String.raw`\input{/secret}`,String.raw`\unknownMacro{x}`])
 it(`rejects unsupported or unsafe commands: ${source}`,()=>{const result=validateEquation(source,1);expect(result.syntaxStatus).toBe("unsupported");expect(result.presentationMathml).toBeNull()})
 it("bounds input and nesting and rejects broken Unicode",()=>{
  for(const source of ["x".repeat(4001),"{".repeat(33)+"x"+"}".repeat(33),"\ud800",String.fromCharCode(0)+"x"]){expect(validateEquation(source,1).syntaxStatus).toBe("failed")}
 })
 it("warns about confusable symbols and delimiters without modifying mathematical meaning",()=>{
  const result=validateEquation("O+l=1",1);expect(result.selectedLatex).toBe("O+l=1");expect(result.issues.some((i)=>i.code==="AMBIGUOUS_SYMBOL")).toBe(true)
  expect(validateEquation("(x+1",1).issues.some((i)=>i.code==="DELIMITER_REVIEW")).toBe(true)
 })
})
describe("MathML boundary",()=>{
 for(const markup of ['<math><script>alert(1)</script></math>','<math><mi onclick="x">a</mi></math>','<math><mi href="https://evil.invalid">a</mi></math>','<!DOCTYPE x [<!ENTITY bad "x">]><math>&bad;</math>','<math><annotation-xml><div>x</div></annotation-xml></math>','<math style="color:red"><mi>a</mi></math>'])
 it("rejects active markup and external resource attributes",()=>expect(()=>sanitizePresentationMathml(markup)).toThrow())
 it("retains escaped literal text instead of creating HTML nodes",()=>{
  const safe=sanitizePresentationMathml('<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>&lt;img src=x&gt;</mtext></math>');expect(safe).toContain("&lt;img src=x&gt;");expect(safe).not.toContain("<img")
 })
})
