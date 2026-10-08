# Transbordo SELIM — registros diretos

Interface de registros, sem login e sem consultas de relatórios. Não hospeda planilhas nem credenciais.

Saída de carreta → retorno com peso em kg ou toneladas. O campo de manifesto foi retirado das novas saídas. Registro de coletor → bairro, fiscal e vínculo opcional com uma viagem. A confirmação mostra o peso convertido antes de gravar.

Placas, bairros e fiscais são selecionados do cadastro. O Apps Script grava nas abas `Viagens_Carretas` e `Registros_Coletores` da base operacional marxb50, com bloqueio de concorrência e identificador de envio contra duplicidade. O portal usa essa mesma conexão.

Relatórios e históricos consolidados não são disponibilizados aqui. A consulta dos registros operacionais pelo portal ocorre exclusivamente no servidor, mediante chave privada, depois da autenticação do Admin. Os manifestos já gravados foram preservados em uma coluna histórica oculta na planilha.

O link é público: quem o receber poderá enviar registros operacionais. Não coloque dados pessoais sensíveis nas observações. Os dados históricos dos Forms não são apagados nem reescritos.

## Uso sem internet

Depois de abrir o link conectado pelo menos uma vez em um aparelho e navegador, a página e as últimas placas, bairros, fiscais e viagens ficam disponíveis para uso offline. Saídas, retornos e registros de coletores feitos sem conexão são guardados no IndexedDB daquele aparelho e enviados à mesma planilha quando a conexão voltar ou quando a pessoa tocar em “Sincronizar agora”. O identificador de cada envio é mantido na tentativa de sincronização para evitar duplicidade.

Um registro pendente ainda não está na planilha nem no relatório do Admin. A tela mostra a quantidade e permite conferir o que continua aguardando. Se o servidor recusar um envio (por exemplo, uma viagem que deixou de estar aberta), o registro permanece no aparelho e é marcado para conferência; ele não é descartado automaticamente. Não limpe os dados do navegador, não desinstale o navegador e não troque de aparelho até ver a confirmação de sincronização. O envio offline depende do mesmo aparelho/navegador e do armazenamento local do navegador; não há sincronização em segundo plano garantida se a página estiver fechada.
