# Governança e provedores de IA — SIGDEC

## Princípio central
A IA no SIGDEC é exclusivamente consultiva. A decisão final pertence sempre ao usuário humano autorizado.

## Restrições invioláveis
A IA incorporada:
- não altera registros, cadastros, prioridades, status, documentos, permissões, usuários, configurações, integrações ou código;
- não aprova, assina, protocola, envia ou exclui registros;
- não executa ações administrativas;
- não descobre, solicita, infere, enumera ou revela senhas, tokens, cookies, sessões, chaves privadas, segredos ou hashes de senha;
- não obtém acesso a contas, perfis ou dados de terceiros;
- não recebe credenciais digitadas pelo usuário;
- não substitui responsável técnico, comando da operação ou autoridade competente.

## Fluxo de minutas técnicas
1. O usuário solicita uma prévia assistida.
2. A IA gera somente uma prévia em memória.
3. Nenhum documento é criado no banco nessa etapa.
4. O usuário revisa integralmente o texto.
5. Somente se clicar explicitamente em **Salvar minuta revisada** o SIGDEC cria o registro.
6. Aprovação e encaminhamento continuam sendo ações humanas separadas e auditadas.

## Provedores incorporados opcionais
O servidor pode tentar, em ordem configurável:
- OpenAI;
- Google Gemini API;
- GroqCloud;
- Ollama local (opcional).

Somente provedores configurados no ambiente seguro são utilizados. Chaves nunca são retornadas à interface. Ollama não exige chave, mas sua URL deve apontar apenas para infraestrutura local/confiável controlada pela Prefeitura.

A ordem pode variar por tarefa: respostas contextuais priorizam baixa latência; minutas técnicas priorizam provedores configurados para revisão estruturada.

## Ferramentas externas
Atalhos disponíveis na Central de IA:
- ChatGPT — https://chatgpt.com/
- Gemini — https://gemini.google.com/app
- Google AI Studio — https://aistudio.google.com/apps
- Groq Playground — https://console.groq.com/playground
- Hugging Face Inference Playground — https://huggingface.co/spaces/huggingface/inference-playground

Esses sites são externos ao SIGDEC. Nenhum dado é enviado automaticamente. O usuário deve evitar compartilhar dados pessoais desnecessários, documentos sigilosos e qualquer credencial.

## Contexto mínimo
O assistente contextual recebe apenas dados autorizados e minimizados para a tela atual. Dados de ocorrência enviados à IA são reduzidos aos campos operacionais necessários.

## Auditoria
O SIGDEC registra metadados e hashes da interação para rastreabilidade, sem registrar segredos.
