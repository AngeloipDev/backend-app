const { sendEmailRegister, sendEmailReset } = require("../helpers/sendMail");
const { activation, refresh, access } = require("../helpers/createToken");
const { validateEmail } = require("../helpers/validateEmail");
const { uploadImage, deleteImage } = require("../helpers/cloudinary");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const fs = require("fs-extra");
const { google } = require("googleapis");
const { OAuth2 } = google.auth;
const userSchema = require("../schemas/user");

const userController = {
  register: async (req, res, next) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password)
        return res
          .status(400)
          .json({ msg: "Por favor, complete todos los campos" });

      if (!validateEmail(email))
        return res
          .status(400)
          .json({ msg: "Por favor, ingrese un correo electrónico válido" });

      const user = await userSchema.findOne({ email });

      if (user)
        return res.status(400).json({ msg: "El correo ya está en uso" });

      if (password.length < 6)
        return res
          .status(400)
          .json({ msg: "La contraseña debe tener al menos 6 caracteres" });

      const hashPass = await bcrypt.hash(password, 5);

      /* const newUser = { name, email, password: hashPass };
      const activationToken = activation(newUser);
      const url = `http://localhost:3000/api/user/auth/activate/${activationToken}`;
      sendEmailRegister(email, url, "Verifique su cuenta"); */

      const newUser = new userSchema({ name, email, password: hashPass });

      await newUser.save();

      return res.status(200).json({ msg: "Registrado correctamente" });
    } catch (error) {
      next(error);
    }
  },
  logIn: async (req, res, next) => {
    try {
      const { email, password } = req.body;

      const user = await userSchema.findOne({ email });

      if (!user)
        return res
          .status(400)
          .json({ msg: "El correo no pertenece a una cuenta" });

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch)
        return res.status(400).json({ msg: "Contraseña incorrecta" });

      const rf_token = refresh({ id: user._id });

      res.cookie("rftoken", rf_token, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax"
      });

      res.status(200).json({ msg: `Bienvenido ${user.name}` });
    } catch (error) {
      next(error);
    }
  },
  accessToken: async (req, res, next) => {
    try {
      const rf_token = req.cookies.rftoken;

      if (!rf_token)
        return res.status(400).json({ msg: "Por favor, inicie sesión" });

      jwt.verify(rf_token, process.env.REFRESH_TOKEN, (err, user) => {
        if (err)
          return res
            .status(400)
            .json({ msg: "Por favor, inicie sesión nuevamente" });

        const ac_token = access({ id: user.id });

        return res.status(200).json({ ac_token });
      });
    } catch (error) {
      next(error);
    }
  },
  forgotPassword: async (req, res, next) => {
    try {
      const { email } = req.body;

      const user = await userSchema.findOne({ email });

      if (!user)
        return res
          .status(400)
          .json({ msg: "El correo no está asociado a una cuenta" });

      const ac_token = access({ id: user.id });

      const url = `http://localhost:3000/reset-password/${ac_token}`;
      const name = user.name;

      sendEmailReset(email, url, "Restablecer contraseña", name);

      res.status(200).json({
        msg: "Se envió un enlace para restablecer su contraseña, por favor revise su correo electrónico"
      });
    } catch (error) {
      next(error);
    }
  },
  resetPassword: async (req, res, next) => {
    try {
      const { password } = req.body;

      if (password.length < 6)
        return res
          .status(400)
          .json({ msg: "La contraseña debe tener al menos 6 caracteres" });

      const hashPass = await bcrypt.hash(password, 5);

      await userSchema.findByIdAndUpdate(
        { _id: req.user.id },
        { password: hashPass }
      );

      res.status(200).json({ msg: "La contraseña fue restablecida" });
    } catch (error) {
      next(error);
    }
  },
  info: async (req, res, next) => {
    try {
      const user = await userSchema.findById(req.user.id).select("-password");

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  },
  update: async (req, res, next) => {
    try {
      const { name, avatar } = req.body;

      await userSchema.findByIdAndUpdate(
        { _id: req.user.id },
        { name, avatar }
      );

      res.status(200).json({ msg: "Informacion actualizada" });
    } catch (error) {
      next(error);
    }
  },
  signOut: async (req, res, next) => {
    try {
      res.clearCookie("rftoken");

      return res.status(200).json({ msg: "Ha cerrado sesión" });
    } catch (error) {
      next(error);
    }
  },
  googleLogin: async (req, res, next) => {
    try {
      const { tokenId } = req.body;

      const client = new OAuth2(process.env.G_CLIENT_ID);

      const verify = await client.verifyIdToken({
        idToken: tokenId,
        audience: process.env.G_CLIENT_ID
      });

      const { email_verified, email, name, picture } = verify.payload;

      if (!email_verified)
        return res
          .status(400)
          .json({ msg: "Verificación de correo electrónico fallida" });

      const user = await userSchema.findOne({ email });

      if (user) {
        const rf_token = refresh({ id: user._id });

        res.cookie("rftoken", rf_token, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000,
          sameSite: "lax"
        });

        res.status(200).json({ msg: `Bienvenido ${name}` });
      } else {
        const password = email + process.env.G_CLIENT_ID;
        const hashPassword = await bcrypt.hash(password, 5);
        const newUser = new userSchema({
          name,
          email,
          password: hashPassword,
          avatar: {
            url: picture,
            public_id: ""
          }
        });

        const user_data = await newUser.save();

        const rf_token = refresh({ id: user_data._id });
        res.cookie("rftoken", rf_token, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000,
          sameSite: "lax"
        });

        res.status(200).json({ msg: `Bienvenido ${name}` });
      }
    } catch (error) {
      next(error);
    }
  },
  uploadAvatar: async (req, res, next) => {
    try {
      const result = await uploadImage(req.file.path);
      await fs.remove(req.file.path);

      return res.status(200).json({ msg: "Good Job" });
    } catch (error) {
      next(error);
    }
  },
  verifyToken: async (req, res, next) => {
    try {
      const { token } = req.body;
      jwt.verify(rf_token, process.env.ACCESS_TOKEN, (err, user) => {
        if (err)
          return res.status(400).json({ msg: "El enlace ya no es válido" });

        return res.status(200);
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = userController;
