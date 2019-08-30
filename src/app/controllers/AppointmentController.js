import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';

import User from '../models/User';
import Appointment from '../models/Appointment';
import File from '../models/File';
import Notification from '../schemas/Notification';
import Queue from '../../lib/Queue';
import CancellationMail from '../jobs/CancellationMail';

class AppointmentController {
  async store(req, res) {
    const schema = Yup.object().shape({
      date: Yup.date().required(),
      provider_id: Yup.number().required(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const { provider_id, date } = req.body;
    const isProvider = await User.findOne({
      where: { id: provider_id, provider: true },
    });
    if (!isProvider) {
      return res
        .status(401)
        .json({ error: 'You can only create appointmens with providers' });
    }
    if (provider_id === req.userId) {
      return res
        .status(401)
        .json({ error: 'You cannot realize this operation' });
    }
    const hourStart = startOfHour(parseISO(date));
    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({ error: 'Past dates are not permitted' });
    }

    const checkAvailability = await Appointment.findOne({
      where: { provider_id, canceled_at: null, date },
    });

    if (checkAvailability) {
      return res
        .status(400)
        .json({ error: 'appointment date is not available' });
    }

    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date: hourStart,
    });
    const user = await User.findByPk(req.userId);

    const formattedDate = format(
      hourStart,
      "'dia' dd 'de' MMMM', às' H:mm'h'",
      { locale: pt }
    );

    await Notification.create({
      content: `Novo agendamento de ${user.name} para o ${formattedDate} `,
      user: provider_id,
    });
    return res.json(appointment);
  }

  async index(req, res) {
    const { page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;

    const appointments = await Appointment.findAll({
      where: { user_id: req.userId, canceled_at: null },
      order: ['date'],
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: {
            model: File,
            as: 'avatar',
            attributes: ['id', 'url', 'path'],
          },
        },
      ],
      attributes: ['id', 'date', 'past', 'cancellable'],
      limit,
      offset,
    });
    return res.json(appointments);
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        { model: User, as: 'provider', attributes: ['name', 'email'] },
        { model: User, as: 'user', attributes: ['name'] },
      ],
    });

    if (appointment.user_id !== req.userId) {
      return res
        .status(401)
        .json({ error: 'You dont have permission to cancel this appointment' });
    }

    const dateWithSub = subHours(appointment.date, 2);
    if (isBefore(dateWithSub, new Date())) {
      return res
        .status(401)
        .json({ error: 'You can only cancel appotint two hours in advance' });
    }

    appointment.canceled_at = new Date();
    await appointment.save();
    await Queue.add(CancellationMail.key, { appointment });
    res.json(appointment);
  }
}

export default new AppointmentController();
