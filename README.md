# Transbordo SELIM — registros diretos

Interface de registros, sem login e sem consultas de relatórios. Não hospeda planilhas nem credenciais.

Saída de carreta → retorno com peso em kg ou toneladas. Registro de coletor → bairro, fiscal e vínculo opcional com uma viagem. A confirmação mostra o peso convertido antes de gravar.

Placas, bairros e fiscais são selecionados do cadastro. O Apps Script grava nas abas `Viagens_Carretas` e `Registros_Coletores` da base operacional marxb50, com bloqueio de concorrência e identificador de envio contra duplicidade. O portal usa essa mesma conexão.

Relatórios e históricos consolidados não são disponibilizados aqui. A consulta dos registros operacionais pelo portal ocorre exclusivamente no servidor, mediante chave privada, depois da autenticação do Admin.

O link é público: quem o receber poderá enviar registros operacionais. Não coloque dados pessoais sensíveis nas observações. Os dados históricos dos Forms não são apagados nem reescritos.
