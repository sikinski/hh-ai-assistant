-- Дата, когда отклик отправлен на hh.ru (кнопка «Я отправила отклик»).
ALTER TABLE "Vacancy" ADD COLUMN "appliedAt" TIMESTAMP(3);
