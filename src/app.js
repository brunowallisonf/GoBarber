import 'dotenv/config';
import express from 'express';

import path from 'path';
import Youch from 'youch';

import * as Sentry from '@sentry/node';
import 'express-async-errors';
import routes from './routes';
import './database';

import sentryConfig from './config/sentry';

class App {
  constructor() {
    this.server = express();
    Sentry.init(sentryConfig);

    this.middlewares();
    this.routes();
    this.exceptionHandler();
  }

  middlewares() {
    this.server.use(Sentry.Handlers.requestHandler());
    this.server.use(express.json());
    this.server.use(
      '/files',
      express.static(path.resolve(__dirname, '..', 'tmps', 'uploads'))
    );
  }

  routes() {
    this.server.use(routes);
    this.server.use(Sentry.Handlers.errorHandler());
  }

  exceptionHandler() {
    this.server.use(async (error, req, res, next) => {
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ error: 'internal server error' });
      }
      const errors = await new Youch(error, req).toJSON();
      return res.status(500).json(errors);
    });
  }
}

export default new App().server;
